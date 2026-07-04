import type { DspTransport } from '@/transport/DspTransport';
import * as proto from '@/protocol';
import { Codec, utf8Truncate, type Result } from '@/utils';
import * as domain from '@/domain';
import { fromBulkParams, narrowInputSource, type DeviceState } from '@/protocol/snapshotCodec';
import { deriveCapabilities, type DeviceCapabilities, type FirmwareVersion } from '@/protocol/capabilities';

// Semver face of the wire-version floor that lives in capabilities.ts; shown in
// the reject message.
const MIN_SUPPORTED_FW = '1.1.4';

// Thrown at connect when firmware predates the supported floor. Carries the
// versions so the connect UI can render an upgrade prompt.
export class UnsupportedFirmware extends Error {
  constructor(readonly firmwareVersion: string, readonly minimum: string = MIN_SUPPORTED_FW) {
    super(`DSPi firmware ${firmwareVersion} is older than the minimum supported ${minimum}.`);
    this.name = 'UnsupportedFirmware';
  }
}

// Thrown at connect when a wire-supported device reports a parameter packet
// shorter than the V10 floor (malformed/truncated firmware). The console treats
// V10 sections as guaranteed, so such a device is rejected rather than silently
// defaulting them.
export class UnsupportedDevicePacket extends Error {
  constructor(readonly fwLabel: string, readonly got: number, readonly need: number) {
    super(`DSPi firmware ${fwLabel} sent an incomplete parameter packet (${got} bytes, need at least ${need}). Update the firmware.`);
    this.name = 'UnsupportedDevicePacket';
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
  readonly platformType: domain.PlatformType;
  readonly hardware: domain.HardwareProfile;
  readonly capabilities: DeviceCapabilities;
}

function platformTypeFromId(platformId: number): domain.PlatformType {
  return platformId === 1 ? domain.PlatformType.RP2350 : domain.PlatformType.RP2040;
}

// Forward-compat: an unrecognised future state byte reads as Inactive.
function narrowSpdifInputState(n: number): domain.SpdifInputState {
  switch (n) {
    case domain.SpdifInputState.Inactive:
    case domain.SpdifInputState.Acquiring:
    case domain.SpdifInputState.Locked:
    case domain.SpdifInputState.Relocking:
      return n;
    default:
      return domain.SpdifInputState.Inactive;
  }
}

// GetPlatform packs minor/patch into one byte: high nibble = minor, low = patch.
function fwVersionParts(info: { fwMajor: number; fwMinorPatch: number }): FirmwareVersion {
  return {
    major: info.fwMajor,
    minor: (info.fwMinorPatch >> 4) & 0xF,
    patch: info.fwMinorPatch & 0xF,
  };
}


export class DspDevice {
  #lastRawBulk: Uint8Array | null = null;

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

    // Peek the bulk packet so capabilities reflect the observed wire structure,
    // not just the (potentially misreported) semver. Read at MaxReadSize so a
    // newer device can send its whole packet without overrun.
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
      throw new UnsupportedFirmware(capabilities.fwLabel);
    }
    // A supported wire version must also carry at least its generation's
    // floor payload (V10: 2960 B; V16: the full 5864 B packet). A shorter
    // packet means the device omits sections the console treats as
    // guaranteed -- reject instead of silently defaulting them.
    const minPayload = proto.Wire.bulkSizeForVersion(capabilities.wireGen);
    if (bulk.payloadLength < minPayload) {
      throw new UnsupportedDevicePacket(capabilities.fwLabel, bulk.payloadLength, minPayload);
    }

    const platformType = platformTypeFromId(platform.platformId);
    const hardware = domain.createHardwareProfile(platformType, capabilities.wireGen);
    return {
      serial: serial.trim(),
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

  // Raw bytes of the last bulk packet read. Substrate for the deferred per-field
  // notify patch path and passthrough writes; unused by Layer 1.
  get lastRawBulk(): Uint8Array | null {
    return this.#lastRawBulk;
  }

  protected deviceChannel(channel: domain.ChannelId): domain.ChannelId {
    return domain.wireChannelFor(this.hardware, channel);
  }

  // Fetch the wire packet and return the domain view. The sole app-facing read path.
  async getSnapshot(): Promise<domain.DspSnapshot> {
    return fromBulkParams(this.hardware, await this.getAllParams());
  }

  // Opaque wire-packet capture for device-to-device paste; runtime never inspects it.
  async captureState(): Promise<DeviceState> {
    return (await this.getAllParams()) as DeviceState;
  }

  async restoreState(state: DeviceState): Promise<void> {
    await this.setAllParams(state);
  }

  async getAllParams(): Promise<proto.BulkParams> {
    const bytes = await this.transport.ctrlIn(proto.WireCmd.GetAllParams.code, 0, proto.Wire.BulkLimits.MaxReadSize);
    this.#lastRawBulk = bytes;
    return proto.parseBulkParams(bytes);
  }

  // Read one notification packet, or null if the transport has no notify endpoint.
  async readNotification(): Promise<Uint8Array | null> {
    return this.transport.notifyIn
      ? this.transport.notifyIn(proto.NOTIFY_PACKET_SIZE)
      : null;
  }

  // Push a complete DSP state in one control-OUT. Firmware applies it in its
  // main loop (~5 ms); callers needing the change visible should re-fetch.
  // Always emits at THIS device's generation: V16 firmware accepts only the
  // exact full-size packet, and a state captured from a device of the other
  // generation converts through the max-shaped DTO (missing rows default,
  // extra rows drop).
  async setAllParams(bulk: proto.BulkParams): Promise<void> {
    const bytes = proto.buildBulkParams(bulk, this.capabilities.wireGen);
    await this.transport.ctrlOut(proto.WireCmd.SetAllParams.code, 0, bytes);
  }

  // V16 devices use the wide combined-status layout (u32 clip flags + live
  // active-input-count byte) and the 5-bit band field in GetEqParam wValues.
  private get isWideWire(): boolean {
    return this.capabilities.wireGen === 16;
  }

  async getSystemStatus(): Promise<proto.SystemStatus> {
    const numCh = this.hardware.totalChannelCount;
    const wide = this.isWideWire;
    const bytes = await this.transport.ctrlIn(
      proto.WireCmd.GetStatus.code, 9, proto.systemStatusSize(numCh, wide),
    );
    return proto.parseSystemStatus(bytes, numCh, wide);
  }

  // Slow-poll telemetry (env scalars + cumulative error counters). Each wValue
  // is a separate vendor read; allSettled lets a single STALL on one wValue
  // (older firmware missing a counter) leave the rest of the panel populated.
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

  // Persistence: 0x51/0x52/0x53 are action-style IN with a 1-byte FlashResult.
  async factoryReset(): Promise<Result<void, proto.FlashResult>> {
    return proto.flashResultFromByte(await proto.actionCmd(this.transport, proto.WireCmd.FactoryReset));
  }

  // 0x83 OUT, no payload. Clears latched clip flags so they can re-arm.
  async clearClips(): Promise<void> {
    await this.transport.ctrlOut(proto.WireCmd.ClearClips.code, 0, new Uint8Array(0));
  }

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

  // Action-style IN: persists live master volume to flash. Returns ok-boolean;
  // transfer failures throw rather than surfacing the status byte.
  async saveMasterVolume(): Promise<boolean> {
    const r = await this.transport.ctrlIn(proto.WireCmd.SaveMasterVolume.code, 0, 1);
    return r.length >= 1 && r[0] === 0;
  }

  // SetMatrixRoute always sends the full crosspoint state (enabled+invert+
  // gainDb); callers must merge a patch with current snapshot values first.
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

  // Wire surface for the 11-command preset system (0x90-0x9A).
  async getPresetDirectory(): Promise<domain.PresetDirectoryInfo> {
    const bytes = await this.transport.ctrlIn(
      proto.WireCmd.PresetGetDir.code, 0, proto.PresetDirRequestSize,
    );
    // decodePadded zero-extends a legacy 6-byte response to the 7-byte schema;
    // masterVolumeMode then reads 0 (= Independent), the correct legacy semantic.
    const r = Codec.decodePadded(proto.PresetDirectory, bytes);
    return {
      occupiedSlotsSet: occupiedMaskToSet(r.occupiedMask),
      startupMode:      r.startupMode,
      defaultSlot:      r.defaultSlot as domain.PresetSlot,
      lastActiveSlot:   r.lastActiveSlot === 0xFF ? null : (r.lastActiveSlot as domain.PresetSlot),
      outputConfigMode: r.outputConfigMode as domain.OutputConfigMode,
      masterVolumeMode: r.masterVolumeMode as domain.MasterVolumeMode,
    };
  }

  // 0x9A: returns the active slot (0..9), or null for "no active slot". The
  // sentinel 0xFF and any other out-of-range byte collapse to null (not throw)
  // so the UI's single null->0 coercion handles all unusable responses
  // uniformly; persistence-aware code treats null as "no slot to write to".
  async getActivePreset(): Promise<domain.PresetSlot | null> {
    const r = await this.transport.ctrlIn(proto.WireCmd.PresetGetActive.code, 0, 1);
    if (r.length < 1) return null;
    const b = r[0];
    if (b === 0xFF || b >= 10) return null;
    return b as domain.PresetSlot;
  }

  // 0x93/0x94: 32-byte NUL-terminated UTF-8 name per slot; wValue carries the
  // slot. Names are cropped at a codepoint boundary to fit the 31-byte budget.
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

  async setOutputConfigMode(mode: domain.OutputConfigMode): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetOutputConfigMode, mode);
  }

  // Per-parameter ("granular") lane: every write goes through a granular verb.
  // The all-params packet is read-only here (getSnapshot) plus the paste-only
  // restoreState write; the edit path is entirely per-field.

  async setFilter(channel: domain.ChannelId, band: number, p: domain.FilterParams): Promise<void> {
    const wireChannel = this.deviceChannel(channel);
    return proto.writeCmd(this.transport, proto.WireCmd.SetEqParam, {
      channel: wireChannel, band,
      type: p.type, frequency: p.frequency, q: p.q, gain: p.gain,
    });
  }

  // The granular getters below (getFilter/getMatrixRoute/getOutput*/getInputPreamp/
  // getChannelName/getPresetStartup/etc.) mostly exist as HIL or unit-test roundtrip
  // coverage for the granular write path -- getSnapshot/getAllParams is the app read
  // path. Exceptions: getBypass, getSavedMasterVolume, getSpdifRxStatus, and
  // getDacHwMute are also read by production code (linkProbe/presets/poll/actions).
  // Kept as the per-verb read half of the granular contract.

  // One ctrlIn per parameter with a bit-packed wValue. Not atomic against
  // concurrent writers; use getAllParams() for an atomic snapshot. `decode`
  // (not `decodePadded`) makes a truncated read throw rather than zero-pad.
  // V16 widened the band field to 5 bits -- (band << 3) | param -- so
  // crossover bands at 20..23 stay addressable; V10 packs (band << 4) | param.
  async getFilter(channel: domain.ChannelId, band: number): Promise<domain.FilterParams> {
    const wireChannel = this.deviceChannel(channel);
    const code = proto.WireCmd.GetEqParam.code;
    const wValue = this.isWideWire
      ? (param: number) => ((wireChannel & 0xFF) << 8) | ((band & 0x1F) << 3) | (param & 0x7)
      : (param: number) => ((wireChannel & 0xFF) << 8) | ((band & 0xF) << 4) | (param & 0xF);
    const t = this.transport;
    const [typeBytes, freqBytes, qBytes, gainBytes] = await Promise.all([
      t.ctrlIn(code, wValue(0), 4),
      t.ctrlIn(code, wValue(1), 4),
      t.ctrlIn(code, wValue(2), 4),
      t.ctrlIn(code, wValue(3), 4),
    ]);
    return {
      type:      Codec.decode(Codec.u32, typeBytes) as domain.FilterType,
      bypass:    false,  // not carried by the per-band GetEqParam protocol
      frequency: Codec.decode(Codec.f32, freqBytes),
      q:         Codec.decode(Codec.f32, qBytes),
      gain:      Codec.decode(Codec.f32, gainBytes),
    };
  }

  async setBypass(enabled: boolean): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetBypass, enabled);
  }

  async getBypass(): Promise<boolean> {
    return proto.readCmd(this.transport, proto.WireCmd.GetBypass);
  }

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

  // GetMatrixRoute packs input/output into wValue since the transport surface
  // exposes only wValue (no wIndex).
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

  // unused: no production, HIL, or unit-test caller remains.
  async getOutputEnable(output: domain.OutputSlot): Promise<boolean> {
    return proto.readCmd(this.transport, proto.WireCmd.GetOutputEnable, output);
  }

  // unused: no production, HIL, or unit-test caller remains.
  async getOutputGain(output: domain.OutputSlot): Promise<number> {
    return proto.readCmd(this.transport, proto.WireCmd.GetOutputGain, output);
  }

  async setOutputMute(output: domain.OutputSlot, mute: boolean): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetOutputMute, mute, output);
  }

  // unused: no production, HIL, or unit-test caller remains.
  async getOutputMute(output: domain.OutputSlot): Promise<boolean> {
    return proto.readCmd(this.transport, proto.WireCmd.GetOutputMute, output);
  }

  async setOutputDelay(output: domain.OutputSlot, ms: number): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetOutputDelay, ms, output);
  }

  // unused: no production, HIL, or unit-test caller remains.
  async getOutputDelay(output: domain.OutputSlot): Promise<number> {
    return proto.readCmd(this.transport, proto.WireCmd.GetOutputDelay, output);
  }

  async setOutputType(slot: domain.I2sPairSlot, type: number): Promise<Result<void, proto.PinConfigResult>> {
    const wValue = ((type & 0xFF) << 8) | (slot & 0xFF);
    return proto.pinConfigResultFromByte(await proto.actionCmd(this.transport, proto.WireCmd.SetOutputType, wValue));
  }

  async getOutputType(slot: domain.I2sPairSlot): Promise<number> {
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

  async setMckMultiplier(encoded: number): Promise<Result<void, proto.PinConfigResult>> {
    return proto.pinConfigResultFromByte(await proto.actionCmd(this.transport, proto.WireCmd.SetMckMultiplier, encoded & 0x01));
  }

  async getMckMultiplier(): Promise<number> {
    return proto.actionCmd(this.transport, proto.WireCmd.GetMckMultiplier, 0);
  }

  // Names are cropped to fit the 31-byte UTF-8 wire budget; validation and
  // user-facing errors belong at the state/UI layer above.
  async setChannelName(channel: domain.ChannelId, name: string): Promise<void> {
    const wireChannel = this.deviceChannel(channel);
    return proto.writeCmd(this.transport, proto.WireCmd.SetChannelName, utf8Truncate(name, domain.CHANNEL_NAME_MAX_LEN), wireChannel);
  }

  async getChannelName(channel: domain.ChannelId): Promise<string> {
    return proto.readCmd(this.transport, proto.WireCmd.GetChannelName, this.deviceChannel(channel));
  }

  async getPresetStartup(): Promise<{ mode: number; slot: number }> {
    return proto.readCmd(this.transport, proto.WireCmd.PresetGetStartup);
  }

  async getOutputConfigMode(): Promise<domain.OutputConfigMode> {
    return proto.readCmd(this.transport, proto.WireCmd.GetOutputConfigMode);
  }

  // Firmware echoes 0x01 on success; return a boolean so callers don't see the wire shape.
  async resetBufferStats(): Promise<boolean> {
    const r = await this.transport.ctrlIn(proto.WireCmd.ResetBufferStats.code, 1, 1);
    return r.length >= 1 && r[0] === 0x01;
  }

  // Clear every preset slot in order, pacing between deletes so the firmware's
  // deferred flash erase (~45 ms/slot with interrupts disabled) doesn't drop the
  // next control transfer into a USB blackout window. Returns the first
  // non-recoverable failure; an empty-slot delete is success. pacingMs: 0 in tests.
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

  async setLoudnessEnabled(enabled: boolean): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetLoudnessEnabled, enabled);
  }

  async setLoudnessRefSpl(db: number): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetLoudnessRefSpl, db);
  }

  async setLoudnessIntensity(pct: number): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetLoudnessIntensity, pct);
  }

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

  // v1.1.4 granular surface (unconditional: the V10 floor guarantees support).

  // Per-band EQ bypass. wValue = (wireChannel<<8)|band, mirroring getFilter's
  // channel remap (e.g. RP2040 PDM -> wire channel 6).
  async setBandBypass(channel: domain.ChannelId, band: number, bypassed: boolean): Promise<void> {
    const wValue = (this.deviceChannel(channel) << 8) | (band & 0xFF);
    return proto.writeCmd(this.transport, proto.WireCmd.SetBandBypass, bypassed, wValue);
  }

  async getBandBypass(channel: domain.ChannelId, band: number): Promise<boolean> {
    const wValue = (this.deviceChannel(channel) << 8) | (band & 0xFF);
    return proto.readCmd(this.transport, proto.WireCmd.GetBandBypass, wValue);
  }

  // User volume axis (separate from the master-volume limit).
  async setUserVolume(db: number): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetUserVolume, db);
  }

  async getUserVolume(): Promise<number> {
    return proto.readCmd(this.transport, proto.WireCmd.GetUserVolume);
  }

  async setUserMute(mute: boolean): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetUserMute, mute);
  }

  async getUserMute(): Promise<boolean> {
    return proto.readCmd(this.transport, proto.WireCmd.GetUserMute);
  }

  // Input source select (USB / S/PDIF).
  async setInputSource(source: domain.AudioInputSource): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetInputSource, source);
  }

  async getInputSource(): Promise<domain.AudioInputSource> {
    return proto.readCmd(this.transport, proto.WireCmd.GetInputSource);
  }

  // Live S/PDIF-RX lock telemetry (no bulk equivalent).
  async getSpdifRxStatus(): Promise<domain.SpdifRxStatus> {
    const w = await proto.readCmd(this.transport, proto.WireCmd.GetSpdifRxStatus);
    return {
      state:        narrowSpdifInputState(w.state),
      inputSource:  narrowInputSource(w.inputSource),
      lockCount:    w.lockCount,
      lossCount:    w.lossCount,
      sampleRate:   w.sampleRate,
      parityErrors: w.parityErrors,
      fifoFillPct:  w.fifoFillPct,
    };
  }

  // Raw 24-byte IEC-60958 channel-status block (no domain shape yet).
  async getSpdifRxChStatus(): Promise<Uint8Array> {
    return this.transport.ctrlIn(
      proto.WireCmd.GetSpdifRxChStatus.code, 0, proto.Wire.SPDIF_RX_CH_STATUS_LEN,
    );
  }

  // S/PDIF RX GPIO pin. Action-style IN: pin in wValue, returns a
  // PinConfigResult status byte (mirrors setOutputPin).
  async setSpdifRxPin(gpio: number): Promise<Result<void, proto.PinConfigResult>> {
    return proto.pinConfigResultFromByte(await proto.actionCmd(this.transport, proto.WireCmd.SetSpdifRxPin, gpio & 0xFF));
  }

  async getSpdifRxPin(): Promise<number> {
    return proto.readCmd(this.transport, proto.WireCmd.GetSpdifRxPin);
  }

  // LG Sound Sync. Only `enabled` is host-configurable; status read returns the
  // full domain shape (present/volume/muted are runtime state).
  async setLgSoundSyncEnabled(enabled: boolean): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetLgSoundSyncEnabled, enabled);
  }

  async getLgSoundSyncEnabled(): Promise<boolean> {
    return proto.readCmd(this.transport, proto.WireCmd.GetLgSoundSyncEnabled);
  }

  async getLgSoundSyncStatus(): Promise<domain.LgSoundSync> {
    const w = await proto.readCmd(this.transport, proto.WireCmd.GetLgSoundSyncStatus);
    return { enabled: w.enabled, present: w.present, volume: w.volume, muted: w.muted };
  }

  // DAC hardware-mute pin configuration.
  async setDacHwMute(cfg: domain.DacHwMute): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetDacHwMute, cfg);
  }

  async getDacHwMute(): Promise<domain.DacHwMute> {
    const w = await proto.readCmd(this.transport, proto.WireCmd.GetDacHwMute);
    return { enabled: w.enabled, activeLow: w.activeLow, pin: w.pin, holdMs: w.holdMs, releaseMs: w.releaseMs };
  }

  // Pulse the DAC mute pin (~1s) for wiring verification. No payload.
  async testDacHwMute(): Promise<void> {
    await proto.actionCmd(this.transport, proto.WireCmd.TestDacHwMute);
  }

  // V16 / fw 1.1.5 I2S-input surface. Gate on capabilities.features.i2sInput
  // (multichannel variants on .multichannelInput) before calling.

  // The device is the rate authority while I2S input is active; the rate is
  // commanded, not detected. Accepted: 44100 / 48000 / 96000.
  async setInputRate(hz: number): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetInputRate, hz);
  }

  // {current pipeline rate, host-selected I2S input rate}, both Hz.
  async getInputRate(): Promise<{ currentHz: number; selectedHz: number }> {
    const bytes = await this.transport.ctrlIn(proto.WireCmd.GetInputRate.code, 0, 8);
    return {
      currentHz:  Codec.decodePadded(Codec.u32, bytes.subarray(0, 4)),
      selectedHz: Codec.decodePadded(Codec.u32, bytes.subarray(4, 8)),
    };
  }

  // I2S RX data pin for a stereo pair (0..3; pair 0 is the always-present
  // stereo input, RP2040 has only pair 0).
  async setI2sRxPin(pair: number, gpio: number): Promise<Result<void, proto.PinConfigResult>> {
    const wValue = ((pair & 0xFF) << 8) | (gpio & 0xFF);
    return proto.pinConfigResultFromByte(await proto.actionCmd(this.transport, proto.WireCmd.SetI2sRxPin, wValue));
  }

  async getI2sRxPin(pair: number): Promise<number> {
    return proto.readCmd(this.transport, proto.WireCmd.GetI2sRxPin, pair & 0xFF);
  }

  // Active I2S input channel count (2/4/6/8). Raising the count re-validates
  // the newly-activated pairs' pins on the device; a clash returns PinInUse.
  async setI2sInputChannels(count: number): Promise<Result<void, proto.PinConfigResult>> {
    return proto.pinConfigResultFromByte(await proto.actionCmd(this.transport, proto.WireCmd.SetI2sInputChannels, count & 0xFF));
  }

  async getI2sInputChannels(): Promise<number> {
    return proto.readCmd(this.transport, proto.WireCmd.GetI2sInputChannels);
  }

  // Crossover bands (V16+, output channels only) ride the EQ verbs at wire
  // band indices XOVER_BAND_BASE..+3; these wrappers own that offset.
  async setCrossoverBand(channel: domain.ChannelId, xoverIndex: number, p: domain.FilterParams): Promise<void> {
    return this.setFilter(channel, domain.XOVER_BAND_BASE + xoverIndex, p);
  }

  async getCrossoverBand(channel: domain.ChannelId, xoverIndex: number): Promise<domain.FilterParams> {
    return this.getFilter(channel, domain.XOVER_BAND_BASE + xoverIndex);
  }

  async setCrossoverBypass(channel: domain.ChannelId, xoverIndex: number, bypassed: boolean): Promise<void> {
    return this.setBandBypass(channel, domain.XOVER_BAND_BASE + xoverIndex, bypassed);
  }

  // Persist the live physical-IO block (output pins, output types, I2S
  // BCK/MCK, S/PDIF RX pin) to the directory's device-global block. Accepted
  // in both output-config modes, dormant in WITH_PRESET. (0x52 was the removed
  // pre-V10 sync LoadParams; the V10 connect floor keeps it unreachable there.)
  async saveOutputConfig(): Promise<Result<void, proto.PresetResult>> {
    return proto.presetResultFromByte(await proto.actionCmd(this.transport, proto.WireCmd.SaveOutputConfig));
  }

  // Reboot into the UF2 bootloader (BOOTSEL mode) for firmware update.
  // Firmware sends a 1-byte success response, waits 100 ms, then calls
  // reset_usb_boot(). The device disconnects mid-flight; the transfer may
  // throw. The caller is expected to treat both outcomes as normal.
  async enterBootloader(): Promise<void> {
    await proto.actionCmd(this.transport, proto.WireCmd.EnterBootloader);
  }
}
