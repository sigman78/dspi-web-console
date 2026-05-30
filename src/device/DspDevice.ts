import type { DspTransport } from '@/transport/DspTransport';
import * as proto from '@/protocol';
import { Codec, utf8Truncate, type Result } from '@/utils';
import * as domain from '@/domain';
import { fromBulkParams, type DeviceState } from './snapshotCodec';
import { deriveCapabilities, type DeviceCapabilities, type FirmwareVersion } from './capabilities';

// Human-readable minimum supported firmware, shown in the reject message. The
// wire-version floor lives in capabilities.ts; this is its semver face.
const MIN_SUPPORTED_FW = '1.1.3';

// Thrown at connect when the device firmware predates the supported floor.
// Carries the actual + minimum versions so the connect UI can render an
// upgrade prompt.
export class UnsupportedFirmware extends Error {
  constructor(readonly firmwareVersion: string, readonly minimum: string = MIN_SUPPORTED_FW) {
    super(`DSPi firmware ${firmwareVersion} is older than the minimum supported ${minimum}.`);
    this.name = 'UnsupportedFirmware';
  }
}

// Bit N of the firmware's u16 occupiedMask = slot N populated.
function occupiedMaskToSet(mask: number): ReadonlySet<domain.PresetSlot> {
  const s = new Set<domain.PresetSlot>();
  for (let i = 0; i < domain.PRESET_SLOT_COUNT; i++) {
    if (mask & (1 << i)) s.add(i as domain.PresetSlot);
  }
  return s;
}

export interface DspDeviceInfo {
  readonly serial: string;
  readonly firmwareVersion: string;
  readonly platformType: domain.PlatformType;
  readonly hardware: domain.HardwareProfile;
  readonly capabilities: DeviceCapabilities;
}

function platformTypeFromId(platformId: number): domain.PlatformType {
  return platformId === 1 ? domain.PlatformType.RP2350 : domain.PlatformType.RP2040;
}

// GetPlatform packs minor/patch into one byte: high nibble = minor, low = patch.
function fwVersionParts(info: { fwMajor: number; fwMinorPatch: number }): FirmwareVersion {
  return {
    major: info.fwMajor,
    minor: (info.fwMinorPatch >> 4) & 0xF,
    patch: info.fwMinorPatch & 0xF,
  };
}

function firmwareVersion(info: { fwMajor: number; fwMinorPatch: number }): string {
  const { major, minor, patch } = fwVersionParts(info);
  return `${major}.${minor}.${patch}`;
}

export class DspDevice {
  protected constructor(
    protected readonly transport: DspTransport,
    private readonly _info: DspDeviceInfo,
  ) {}

  protected static async resolveInfo(
    transport: DspTransport,
    openTransport: () => Promise<void> = () => transport.open(),
  ): Promise<DspDeviceInfo> {
    await openTransport();
    const [serial, platform] = await Promise.all([
      proto.readCmd(transport, proto.WireCmd.GetSerial),
      proto.readCmd(transport, proto.WireCmd.GetPlatform),
    ]);

    // Peek the bulk packet so capabilities reflect the device's observed wire
    // structure, not just its (potentially misreported) semver. Read at
    // MaxReadSize so a newer device can send its whole packet without overrun;
    // parseBulkParams keeps only the V6 prefix.
    const bulkBytes = await transport.ctrlIn(
      proto.WireCmd.GetAllParams.code, 0, proto.Wire.BulkLimits.MaxReadSize,
    );
    const bulk = proto.parseBulkParams(bulkBytes);

    const capabilities = deriveCapabilities({
      fw:            fwVersionParts(platform),
      wireVersion:   bulk.formatVersion,
      payloadLength: bulk.payloadLength,
      platformId:    platform.platformId,
    });
    if (capabilities.support === 'unsupported') {
      throw new UnsupportedFirmware(firmwareVersion(platform));
    }

    const platformType = platformTypeFromId(platform.platformId);
    const hardware = domain.createHardwareProfile(platformType);
    return {
      serial: serial.trim(),
      firmwareVersion: firmwareVersion(platform),
      platformType,
      hardware,
      capabilities,
    };
  }

  static async create(
    transport: DspTransport,
    openTransport: () => Promise<void> = () => transport.open(),
  ): Promise<DspDevice> {
    const info = await DspDevice.resolveInfo(transport, openTransport);
    return new DspDevice(transport, info);
  }

  async close(): Promise<void> { await this.transport.close(); }

  get info(): DspDeviceInfo {
    return this._info;
  }

  get hardware(): domain.HardwareProfile {
    return this._info.hardware;
  }

  get capabilities(): DeviceCapabilities {
    return this._info.capabilities;
  }

  protected deviceChannel(channel: domain.ChannelId): domain.ChannelId {
    return domain.wireChannelFor(this.hardware, channel);
  }

  // Snapshot-out: fetch the wire packet and return the domain view. The sole
  // app-facing read path.
  async getSnapshot(): Promise<domain.DspSnapshot> {
    return fromBulkParams(this.hardware, await this.getAllParams());
  }

  // Opaque capture for the device-to-device paste copy. The blob is a wire
  // packet; runtime never inspects it (the brand keeps the wire shape out of
  // runtime types).
  async captureState(): Promise<DeviceState> {
    return (await this.getAllParams()) as DeviceState;
  }

  async restoreState(state: DeviceState): Promise<void> {
    await this.setAllParams(state);
  }

  async getAllParams(): Promise<proto.BulkParams> {
    const bytes = await this.transport.ctrlIn(proto.WireCmd.GetAllParams.code, 0, proto.Wire.BulkLimits.MaxReadSize);
    return proto.parseBulkParams(bytes);
  }

  // Read one notification packet, or null if the transport has no notify
  // endpoint. The notify channel polls this; parsing lives in protocol/notify.
  async readNotification(): Promise<Uint8Array | null> {
    return this.transport.notifyIn
      ? this.transport.notifyIn(proto.NOTIFY_PACKET_SIZE)
      : null;
  }

  // Push a complete DSP state in one control-OUT. Firmware applies it in its
  // main loop (~5 ms); callers needing the change visible should re-fetch.
  async setAllParams(bulk: proto.BulkParams): Promise<void> {
    const bytes = proto.buildBulkParams(bulk);
    await this.transport.ctrlOut(proto.WireCmd.SetAllParams.code, 0, bytes);
  }

  async getSystemStatus(): Promise<proto.SystemStatus> {
    const numCh = this.hardware.totalChannelCount;
    const bytes = await this.transport.ctrlIn(proto.WireCmd.GetStatus.code, 9, numCh * 2 + 4);
    return proto.parseSystemStatus(bytes, numCh);
  }

  // Slow-poll telemetry (env scalars + cumulative error counters). Each
  // wValue is a separate vendor read; WebUSB serialises control transfers
  // anyway, but Promise.allSettled lets a single STALL on one wValue
  // (typical of older firmware missing a counter) leave the rest of the
  // panel populated. The caller folds non-null fields into the store.
  // Run at ~1Hz from poll.ts. See docs/system-status-req.md for the wire
  // format per code.
  async getSystemInfo(): Promise<proto.PartialSystemInfo> {
    const u32 = (wValue: number) =>
      this.transport.ctrlIn(proto.WireCmd.GetStatus.code, wValue, 4)
        .then((b) => Codec.decodePadded(Codec.u32, b));
    const i32 = (wValue: number) =>
      this.transport.ctrlIn(proto.WireCmd.GetStatus.code, wValue, 4)
        .then((b) => Codec.decodePadded(Codec.i32, b));

    const settled = await Promise.allSettled([
      u32(proto.SystemStatusValue.ClockHz),
      u32(proto.SystemStatusValue.CoreVoltageMv),
      u32(proto.SystemStatusValue.SampleRateHz),
      i32(proto.SystemStatusValue.TempCDegC),
      u32(proto.SystemStatusValue.PdmRingOverruns),
      u32(proto.SystemStatusValue.PdmRingUnderruns),
      u32(proto.SystemStatusValue.PdmDmaOverruns),
      u32(proto.SystemStatusValue.PdmDmaUnderruns),
      u32(proto.SystemStatusValue.SpdifOverruns),
      u32(proto.SystemStatusValue.SpdifUnderruns),
      u32(proto.SystemStatusValue.SpdifStarvationsTotal),
    ]);

    const v = (i: number): number | null =>
      settled[i].status === 'fulfilled'
        ? (settled[i] as PromiseFulfilledResult<number>).value
        : null;

    return {
      clockHz:               v(0),
      coreVoltageMv:         v(1),
      sampleRateHz:          v(2),
      tempCDegC:             v(3),
      pdmRingOverruns:       v(4),
      pdmRingUnderruns:      v(5),
      pdmDmaOverruns:        v(6),
      pdmDmaUnderruns:       v(7),
      spdifOverruns:         v(8),
      spdifUnderruns:        v(9),
      spdifStarvationsTotal: v(10),
    };
  }

  async getBufferStats(): Promise<proto.BufferStats | null> {
    // Stays manual: parseBufferStats returns null on short responses;
    // readCmd would throw, defeating that contract.
    const bytes = await this.transport.ctrlIn(proto.WireCmd.GetBufferStats.code, 0, Codec.sizeOf(proto.Wire.BufferStats));
    return proto.parseBufferStats(bytes);
  }

  // Persistence ----------------------------------------------------------
  // 0x51 / 0x52 / 0x53 are action-style IN with a 1-byte FlashResult.

  async factoryReset(): Promise<Result<void, proto.FlashResult>> {
    return proto.flashResultFromByte(await proto.actionCmd(this.transport, proto.WireCmd.FactoryReset));
  }

  // Telemetry actions -----------------------------------------------------

  // 0x83 OUT, no payload. Clears latched clip flags so they can re-arm.
  async clearClips(): Promise<void> {
    await this.transport.ctrlOut(proto.WireCmd.ClearClips.code, 0, new Uint8Array(0));
  }

  // Preamps / master volume ------------------------------------------------

  async setMasterPreamp(db: number): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetPreamp, db);
  }

  async setInputPreamp(channel: domain.InputSlot, db: number): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetInputPreamp, db, channel);
  }

  async setMasterVolume(db: number): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetMasterVolume, db);
  }

  async setMasterVolumeMode(mode: domain.MasterVolumeMode): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetMasterVolumeMode, mode);
  }

  // Action-style IN: persists live master volume to flash, returns 1-byte
  // PresetResult status. 0 = ok. WebUSB transfer failures throw, so the
  // host-side surface is a simple boolean.
  async saveMasterVolume(): Promise<boolean> {
    const r = await this.transport.ctrlIn(proto.WireCmd.SaveMasterVolume.code, 0, 1);
    return r.length >= 1 && r[0] === 0;
  }

  // Matrix mixer ----------------------------------------------------------
  // SetMatrixRoute always sends the full crosspoint state (enabled+invert+
  // gainDb) -- callers must merge any patch with current snapshot values
  // before calling.

  async setMatrixRoute(
    input: domain.InputSlot,
    output: domain.OutputSlot,
    p: { enabled: boolean; invert: boolean; gainDb: number },
  ): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetMatrixRoute, {
      input, output,
      enabled: p.enabled,
      phaseInvert: p.invert,
      gainDb: p.gainDb,
    });
  }

  async setOutputGain(output: domain.OutputSlot, db: number): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetOutputGain, db, output);
  }

  // Presets ---------------------------------------------------------------
  // Wire surface for the 11-command preset system (0x90–0x9A). See
  // docs/HW-PROFILES.md for the persistence model.

  async getPresetDirectory(): Promise<domain.PresetDirectoryInfo> {
    const bytes = await this.transport.ctrlIn(
      proto.WireCmd.PresetGetDir.code, 0, proto.PresetDirRequestSize,
    );
    // decodePadded zero-extends a legacy 6-byte response to the V12+
    // 7-byte schema; masterVolumeMode then reads 0 (= Independent), which
    // is the correct legacy semantic, not a sentinel.
    const r = Codec.decodePadded(proto.PresetDirectory, bytes);
    return {
      occupiedSlotsSet: occupiedMaskToSet(r.occupiedMask),
      startupMode:      r.startupMode,
      defaultSlot:      r.defaultSlot as domain.PresetSlot,
      lastActiveSlot:   r.lastActiveSlot === 0xFF ? null : (r.lastActiveSlot as domain.PresetSlot),
      includePins:      r.includePins,
      masterVolumeMode: r.masterVolumeMode as domain.MasterVolumeMode,
    };
  }

  // 0x9A: returns the active slot (0..9) or `null` for "no active slot".
  // The firmware-documented sentinel is `0xFF` (transient: device powered
  // up before fetchPresetInfo settled, or the directory's last-active
  // byte was never written). Any other byte outside `0..9` is undefined
  // by the spec; we collapse it to `null` rather than `throw` so the UI
  // layer's single coercion (`null → 0`) handles all "unusable" responses
  // uniformly. If a firmware revision starts emitting values in
  // `10..0xFE`, this guard hides it — file an issue against firmware
  // before broadening the surface here.
  //
  // UI layer should coerce `null → 0` for display per the always-active
  // model in HW-PROFILES §0; persistence-aware code (dirty tracking,
  // autosave) should treat `null` as "no slot to write to" and skip.
  async getActivePreset(): Promise<domain.PresetSlot | null> {
    const r = await this.transport.ctrlIn(proto.WireCmd.PresetGetActive.code, 0, 1);
    if (r.length < 1) return null;
    const b = r[0];
    if (b === 0xFF || b >= 10) return null;
    return b as domain.PresetSlot;
  }

  // 0x93 / 0x94: 32-byte NUL-terminated UTF-8 name per slot (0..9).
  // Same codec as channel names; wValue carries the slot index.
  // Names are silently cropped at a codepoint boundary to fit the 31-byte
  // wire budget. Slot is a compile-time `PresetSlot`; no runtime guard here.
  async setPresetName(slot: domain.PresetSlot, name: string): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.PresetSetName, utf8Truncate(name, domain.PRESET_NAME_MAX_LEN), slot);
  }

  async getPresetName(slot: domain.PresetSlot): Promise<string> {
    return proto.readCmd(this.transport, proto.WireCmd.PresetGetName, slot);
  }

  async savePreset(slot: domain.PresetSlot): Promise<Result<void, proto.PresetResult>> {
    return proto.presetResultFromByte(await proto.actionCmd(this.transport, proto.WireCmd.PresetSave, slot));
  }

  async loadPreset(slot: domain.PresetSlot): Promise<Result<void, proto.PresetResult>> {
    return proto.presetResultFromByte(await proto.actionCmd(this.transport, proto.WireCmd.PresetLoad, slot));
  }

  async deletePreset(slot: domain.PresetSlot): Promise<Result<void, proto.PresetResult>> {
    return proto.presetResultFromByte(await proto.actionCmd(this.transport, proto.WireCmd.PresetDelete, slot));
  }

  async setPresetStartup(config: { mode: number; slot: number }): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.PresetSetStartup, config);
  }

  async setPresetIncludePins(include: boolean): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.PresetSetIncludePins, include);
  }

  // Per-parameter ("granular") lane -----------------------------------------
  // Every write goes through a granular verb. The bulk read path
  // (getSnapshot) and the paste-only bulk write path (restoreState) are the
  // only consumers of the all-params packet; the edit path is entirely
  // per-field.

  // EQ
  async setFilter(channel: domain.ChannelId, band: number, p: domain.FilterParams): Promise<void> {
    const wireChannel = this.deviceChannel(channel);
    return proto.writeCmd(this.transport, proto.WireCmd.SetEqParam, {
      channel: wireChannel, band,
      type: p.type, frequency: p.frequency, q: p.q, gain: p.gain,
    });
  }

  // One ctrlIn per parameter with a bit-packed wValue. Not atomic against
  // concurrent writers; for an atomic snapshot use getAllParams(). Type comes
  // back as u32, the rest f32. `decode` (not `decodePadded`) makes a truncated
  // read throw rather than silently zero-pad.
  async getFilter(channel: domain.ChannelId, band: number): Promise<domain.FilterParams> {
    const wireChannel = this.deviceChannel(channel);
    const code = proto.WireCmd.GetEqParam.code;
    const wValue = (param: number) =>
      ((wireChannel & 0xFF) << 8) | ((band & 0xF) << 4) | (param & 0xF);
    const t = this.transport;
    const [typeBytes, freqBytes, qBytes, gainBytes] = await Promise.all([
      t.ctrlIn(code, wValue(0), 4),
      t.ctrlIn(code, wValue(1), 4),
      t.ctrlIn(code, wValue(2), 4),
      t.ctrlIn(code, wValue(3), 4),
    ]);
    return {
      type:      Codec.decode(Codec.u32, typeBytes) as domain.FilterType,
      frequency: Codec.decode(Codec.f32, freqBytes),
      q:         Codec.decode(Codec.f32, qBytes),
      gain:      Codec.decode(Codec.f32, gainBytes),
    };
  }

  // Bypass
  async setBypass(enabled: boolean): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetBypass, enabled);
  }

  async getBypass(): Promise<boolean> {
    return proto.readCmd(this.transport, proto.WireCmd.GetBypass);
  }

  // Preamps / master volume (reads)
  async getMasterPreamp(): Promise<number> {
    return proto.readCmd(this.transport, proto.WireCmd.GetPreamp);
  }

  async getInputPreamp(channel: domain.InputSlot): Promise<number> {
    return proto.readCmd(this.transport, proto.WireCmd.GetInputPreamp, channel);
  }

  async getMasterVolume(): Promise<number> {
    return proto.readCmd(this.transport, proto.WireCmd.GetMasterVolume);
  }

  async getMasterVolumeMode(): Promise<domain.MasterVolumeMode> {
    return proto.readCmd(this.transport, proto.WireCmd.GetMasterVolumeMode);
  }

  async getSavedMasterVolume(): Promise<number> {
    return proto.readCmd(this.transport, proto.WireCmd.GetSavedMasterVolume);
  }

  // Matrix mixer
  // GetMatrixRoute packs input/output into wValue since our transport surface
  // only exposes wValue (no wIndex).
  async getMatrixRoute(
    input: domain.InputSlot,
    output: domain.OutputSlot,
  ): Promise<{ enabled: boolean; invert: boolean; gainDb: number }> {
    const wValue = ((input & 0xFF) << 8) | (output & 0xFF);
    const r = await proto.readCmd(this.transport, proto.WireCmd.GetMatrixRoute, wValue);
    return { enabled: r.enabled, invert: r.phaseInvert, gainDb: r.gainDb };
  }

  async setOutputEnable(output: domain.OutputSlot, on: boolean): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetOutputEnable, on, output);
  }

  async getOutputEnable(output: domain.OutputSlot): Promise<boolean> {
    return proto.readCmd(this.transport, proto.WireCmd.GetOutputEnable, output);
  }

  async getOutputGain(output: domain.OutputSlot): Promise<number> {
    return proto.readCmd(this.transport, proto.WireCmd.GetOutputGain, output);
  }

  async setOutputMute(output: domain.OutputSlot, mute: boolean): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetOutputMute, mute, output);
  }

  async getOutputMute(output: domain.OutputSlot): Promise<boolean> {
    return proto.readCmd(this.transport, proto.WireCmd.GetOutputMute, output);
  }

  async setOutputDelay(output: domain.OutputSlot, ms: number): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetOutputDelay, ms, output);
  }

  async getOutputDelay(output: domain.OutputSlot): Promise<number> {
    return proto.readCmd(this.transport, proto.WireCmd.GetOutputDelay, output);
  }

  async setOutputType(slot: domain.OutputSlot, type: number): Promise<Result<void, proto.PinConfigResult>> {
    const wValue = ((type & 0xFF) << 8) | (slot & 0xFF);
    return proto.pinConfigResultFromByte(await proto.actionCmd(this.transport, proto.WireCmd.SetOutputType, wValue));
  }

  async getOutputType(slot: domain.OutputSlot): Promise<number> {
    return proto.actionCmd(this.transport, proto.WireCmd.GetOutputType, slot);
  }

  // pin-output index is 0..numPinOutputs-1 where the last entry is the PDM sub (distinct from the matrix OutputSlot).
  async setOutputPin(pinOutputIndex: number, pin: number): Promise<Result<void, proto.PinConfigResult>> {
    const wValue = ((pin & 0xFF) << 8) | (pinOutputIndex & 0xFF);
    return proto.pinConfigResultFromByte(await proto.actionCmd(this.transport, proto.WireCmd.SetOutputPin, wValue));
  }

  async getOutputPin(pinOutputIndex: number): Promise<number> {
    return proto.actionCmd(this.transport, proto.WireCmd.GetOutputPin, pinOutputIndex);
  }

  async setI2sBckPin(pin: number): Promise<Result<void, proto.PinConfigResult>> {
    return proto.pinConfigResultFromByte(await proto.actionCmd(this.transport, proto.WireCmd.SetI2sBckPin, pin & 0xFF));
  }

  async getI2sBckPin(): Promise<number> {
    return proto.actionCmd(this.transport, proto.WireCmd.GetI2sBckPin, 0);
  }

  async setMckEnable(on: boolean): Promise<Result<void, proto.PinConfigResult>> {
    return proto.pinConfigResultFromByte(await proto.actionCmd(this.transport, proto.WireCmd.SetMckEnable, on ? 1 : 0));
  }

  async getMckEnable(): Promise<number> {
    return proto.actionCmd(this.transport, proto.WireCmd.GetMckEnable, 0);
  }

  async setMckPin(pin: number): Promise<Result<void, proto.PinConfigResult>> {
    return proto.pinConfigResultFromByte(await proto.actionCmd(this.transport, proto.WireCmd.SetMckPin, pin & 0xFF));
  }

  async getMckPin(): Promise<number> {
    return proto.actionCmd(this.transport, proto.WireCmd.GetMckPin, 0);
  }

  async setMckMultiplier(encoded: number): Promise<Result<void, proto.PinConfigResult>> {
    return proto.pinConfigResultFromByte(await proto.actionCmd(this.transport, proto.WireCmd.SetMckMultiplier, encoded & 0x01));
  }

  async getMckMultiplier(): Promise<number> {
    return proto.actionCmd(this.transport, proto.WireCmd.GetMckMultiplier, 0);
  }

  // Channel names
  // Names are silently cropped to fit the 31-byte UTF-8 wire budget;
  // validation and user-facing errors belong at the state/UI layer above.
  async setChannelName(channel: domain.ChannelId, name: string): Promise<void> {
    const wireChannel = this.deviceChannel(channel);
    return proto.writeCmd(this.transport, proto.WireCmd.SetChannelName, utf8Truncate(name, domain.CHANNEL_NAME_MAX_LEN), wireChannel);
  }

  async getChannelName(channel: domain.ChannelId): Promise<string> {
    return proto.readCmd(this.transport, proto.WireCmd.GetChannelName, this.deviceChannel(channel));
  }

  // Preset read-side
  async getPresetStartup(): Promise<{ mode: number; slot: number }> {
    return proto.readCmd(this.transport, proto.WireCmd.PresetGetStartup);
  }

  async getPresetIncludePins(): Promise<boolean> {
    return proto.readCmd(this.transport, proto.WireCmd.PresetGetIncludePins);
  }

  // Persistence
  async saveParams(): Promise<Result<void, proto.FlashResult>> {
    return proto.flashResultFromByte(await proto.actionCmd(this.transport, proto.WireCmd.SaveParams));
  }

  async loadParams(): Promise<Result<void, proto.FlashResult>> {
    return proto.flashResultFromByte(await proto.actionCmd(this.transport, proto.WireCmd.LoadParams));
  }

  // Telemetry actions
  // Firmware echoes 0x01 on success; return a boolean so callers don't see
  // the wire shape.
  async resetBufferStats(): Promise<boolean> {
    const r = await this.transport.ctrlIn(proto.WireCmd.ResetBufferStats.code, 1, 1);
    return r.length >= 1 && r[0] === 0x01;
  }

  // Clear every preset slot in order, pacing between deletes so the firmware's
  // deferred flash erase (~45 ms per slot with interrupts disabled) doesn't
  // drop the next control transfer into a USB blackout window. Returns the
  // first non-recoverable failure; an empty-slot delete is success (erase is
  // idempotent). pacingMs defaults to 50; pass 0 in tests.
  async clearAllPresets(opts: { pacingMs?: number } = {}): Promise<Result<void, proto.PresetResult>> {
    const pacingMs = opts.pacingMs ?? 50;
    for (let slot = 0 as domain.PresetSlot; slot < 10; slot = (slot + 1) as domain.PresetSlot) {
      const r = await this.deletePreset(slot);
      if (!r.ok && r.code !== proto.PresetResult.SlotEmpty) {
        return r;
      }
      if (slot < 9 && pacingMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, pacingMs));
      }
    }
    return { ok: true, value: undefined };
  }

  // Loudness
  async setLoudnessEnabled(enabled: boolean): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetLoudnessEnabled, enabled);
  }

  async setLoudnessRefSpl(db: number): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetLoudnessRefSpl, db);
  }

  async setLoudnessIntensity(pct: number): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetLoudnessIntensity, pct);
  }

  // Crossfeed
  async setCrossfeedEnabled(enabled: boolean): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetCrossfeedEnabled, enabled);
  }

  async setCrossfeedPreset(preset: domain.CrossfeedPreset): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetCrossfeedPreset, preset);
  }

  async setCrossfeedItd(enabled: boolean): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetCrossfeedItd, enabled);
  }

  async setCrossfeedFreq(hz: number): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetCrossfeedFreq, hz);
  }

  async setCrossfeedFeedDb(db: number): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetCrossfeedFeedDb, db);
  }

  // Volume Leveller
  async setLevellerEnabled(enabled: boolean): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetLevellerEnabled, enabled);
  }

  async setLevellerSpeed(speed: domain.LevellerSpeed): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetLevellerSpeed, speed);
  }

  async setLevellerLookahead(enabled: boolean): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetLevellerLookahead, enabled);
  }

  async setLevellerAmount(pct: number): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetLevellerAmount, pct);
  }

  async setLevellerMaxGain(db: number): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetLevellerMaxGain, db);
  }

  async setLevellerGate(db: number): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetLevellerGate, db);
  }
}
