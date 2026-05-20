import type { DspTransport } from '@/transport/DspTransport';
import {
  Wire,
  parseBulkParams, buildBulkParams, parseSystemStatus, parseBufferStats,
  SystemStatusValue,
  WireCmd, readCmd, writeCmd,
  type BufferStats, type SystemStatus, type BulkParams, type PartialSystemInfo,
  actionCmd, flashResultFromByte, presetResultFromByte,
  PresetResult, type FlashResult,
  PresetDirectory, PresetDirRequestSize,
} from '@/protocol';
import { Codec, utf8Truncate, type Result } from '@/utils';
import {
  type ChannelId, type InputSlot, type OutputSlot,
  createHardwareProfile, wireChannelFor, type HardwareProfile,
  PlatformType,
  CrossfeedPreset, LevellerSpeed, MasterVolumeMode,
  type PresetSlot, PRESET_NAME_MAX_LEN, CHANNEL_NAME_MAX_LEN, PRESET_SLOT_COUNT,
  type PresetDirectoryInfo,
  FilterType, type FilterParams,
} from '@/domain';

// Bit N of the firmware's u16 occupiedMask = slot N populated.
function occupiedMaskToSet(mask: number): ReadonlySet<PresetSlot> {
  const s = new Set<PresetSlot>();
  for (let i = 0; i < PRESET_SLOT_COUNT; i++) {
    if (mask & (1 << i)) s.add(i as PresetSlot);
  }
  return s;
}

export interface DspDeviceInfo {
  readonly serial: string;
  readonly firmwareVersion: string;
  readonly platformType: PlatformType;
  readonly hardware: HardwareProfile;
}

function platformTypeFromId(platformId: number): PlatformType {
  return platformId === 1 ? PlatformType.RP2350 : PlatformType.RP2040;
}

function firmwareVersion(info: { fwMajor: number; fwMinorPatch: number }): string {
  const minor = (info.fwMinorPatch >> 4) & 0xF;
  const patch = info.fwMinorPatch & 0xF;
  return `${info.fwMajor}.${minor}.${patch}`;
}

export class DspDevice {
  private constructor(
    private readonly transport: DspTransport,
    private readonly _info: DspDeviceInfo,
  ) {}

  static async create(
    transport: DspTransport,
    openTransport: () => Promise<void> = () => transport.open(),
  ): Promise<DspDevice> {
    await openTransport();
    const [serial, platform] = await Promise.all([
      readCmd(transport, WireCmd.GetSerial),
      readCmd(transport, WireCmd.GetPlatform),
    ]);
    const platformType = platformTypeFromId(platform.platformId);
    const hardware = createHardwareProfile(platformType);
    return new DspDevice(transport, {
      serial: serial.trim(),
      firmwareVersion: firmwareVersion(platform),
      platformType,
      hardware,
    });
  }

  async close(): Promise<void> { await this.transport.close(); }

  get info(): DspDeviceInfo {
    return this._info;
  }

  get hardware(): HardwareProfile {
    return this._info.hardware;
  }

  #deviceChannel(channel: ChannelId): ChannelId {
    return wireChannelFor(this.hardware, channel);
  }

  async getAllParams(): Promise<BulkParams> {
    const bytes = await this.transport.ctrlIn(WireCmd.GetAllParams.code, 0, Wire.BulkLimits.MaxRequestSize);
    return parseBulkParams(bytes);
  }

  // Push a complete DSP state to the device in one transfer (USB control-OUT 0xA1).
  // Wire payload must be exactly 2896 B (V6); firmware STALLs otherwise — the
  // builder enforces this. Firmware applies the state in its main loop (~5 ms);
  // callers expecting the change to be visible should re-fetch via getAllParams.
  async setAllParams(bulk: BulkParams): Promise<void> {
    const bytes = buildBulkParams(bulk);
    await this.transport.ctrlOut(WireCmd.SetAllParams.code, 0, bytes);
  }

  async getSystemStatus(): Promise<SystemStatus> {
    const numCh = this.hardware.totalChannelCount;
    const bytes = await this.transport.ctrlIn(WireCmd.GetStatus.code, 9, numCh * 2 + 4);
    return parseSystemStatus(bytes, numCh);
  }

  // Slow-poll telemetry (env scalars + cumulative error counters). Each
  // wValue is a separate vendor read; WebUSB serialises control transfers
  // anyway, but Promise.allSettled lets a single STALL on one wValue
  // (typical of older firmware missing a counter) leave the rest of the
  // panel populated. The caller folds non-null fields into the store.
  // Run at ~1Hz from poll.ts. See docs/system-status-req.md for the wire
  // format per code.
  async getSystemInfo(): Promise<PartialSystemInfo> {
    const u32 = (wValue: number) =>
      this.transport.ctrlIn(WireCmd.GetStatus.code, wValue, 4)
        .then((b) => Codec.decodePadded(Codec.u32, b));
    const i32 = (wValue: number) =>
      this.transport.ctrlIn(WireCmd.GetStatus.code, wValue, 4)
        .then((b) => Codec.decodePadded(Codec.i32, b));

    const settled = await Promise.allSettled([
      u32(SystemStatusValue.ClockHz),
      u32(SystemStatusValue.CoreVoltageMv),
      u32(SystemStatusValue.SampleRateHz),
      i32(SystemStatusValue.TempCDegC),
      u32(SystemStatusValue.PdmRingOverruns),
      u32(SystemStatusValue.PdmRingUnderruns),
      u32(SystemStatusValue.PdmDmaOverruns),
      u32(SystemStatusValue.PdmDmaUnderruns),
      u32(SystemStatusValue.SpdifOverruns),
      u32(SystemStatusValue.SpdifUnderruns),
      u32(SystemStatusValue.SpdifStarvationsTotal),
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

  async getBufferStats(): Promise<BufferStats | null> {
    // Stays manual: parseBufferStats returns null on short responses;
    // readCmd would throw, defeating that contract.
    const bytes = await this.transport.ctrlIn(WireCmd.GetBufferStats.code, 0, Codec.sizeOf(Wire.BufferStats));
    return parseBufferStats(bytes);
  }

  // Persistence ----------------------------------------------------------
  // 0x51 / 0x52 / 0x53 are action-style IN with a 1-byte FlashResult.

  async saveParams(): Promise<Result<void, FlashResult>> {
    return flashResultFromByte(await actionCmd(this.transport, WireCmd.SaveParams));
  }

  async loadParams(): Promise<Result<void, FlashResult>> {
    return flashResultFromByte(await actionCmd(this.transport, WireCmd.LoadParams));
  }

  async factoryReset(): Promise<Result<void, FlashResult>> {
    return flashResultFromByte(await actionCmd(this.transport, WireCmd.FactoryReset));
  }

  // Telemetry actions -----------------------------------------------------

  // 0x83 OUT, no payload. Clears latched clip flags so they can re-arm.
  async clearClips(): Promise<void> {
    await this.transport.ctrlOut(WireCmd.ClearClips.code, 0, new Uint8Array(0));
  }

  // 0xB1 IN with wValue=1. Firmware echoes 0x01 on success. Returns the
  // boolean so callers can show a success indicator without leaking the
  // wire-level shape.
  async resetBufferStats(): Promise<boolean> {
    const r = await this.transport.ctrlIn(WireCmd.ResetBufferStats.code, 1, 1);
    return r.length >= 1 && r[0] === 0x01;
  }

  // EQ ---------------------------------------------------------------------

  async setFilter(channel: ChannelId, band: number, p: FilterParams): Promise<void> {
    const wireChannel = this.#deviceChannel(channel);
    return writeCmd(this.transport, WireCmd.SetEqParam, {
      channel: wireChannel, band,
      type: p.type, frequency: p.frequency, q: p.q, gain: p.gain,
    });
  }

  // Multi-read: GetEqParam (0x43) reads each parameter via a separate
  // ctrlIn with a bit-packed wValue. Note this is not atomic against
  // concurrent writers; for an atomic snapshot use getAllParams().
  // Type comes back as u32 (firmware widens it); the rest are f32.
  // Uses `decode` (not `decodePadded`) on each fixed 4-byte payload so a
  // truncated USB read surfaces as a throw rather than silently zero-padding.
  async getFilter(channel: ChannelId, band: number): Promise<FilterParams> {
    const wireChannel = this.#deviceChannel(channel);
    const code = WireCmd.GetEqParam.code;
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
      type:      Codec.decode(Codec.u32, typeBytes) as FilterType,
      frequency: Codec.decode(Codec.f32, freqBytes),
      q:         Codec.decode(Codec.f32, qBytes),
      gain:      Codec.decode(Codec.f32, gainBytes),
    };
  }

  // Bypass -----------------------------------------------------------------

  async setBypass(enabled: boolean): Promise<void> {
    return writeCmd(this.transport, WireCmd.SetBypass, enabled);
  }

  async getBypass(): Promise<boolean> {
    return readCmd(this.transport, WireCmd.GetBypass);
  }

  // Preamps / master volume ------------------------------------------------

  async setMasterPreamp(db: number): Promise<void> {
    return writeCmd(this.transport, WireCmd.SetPreamp, db);
  }

  async getMasterPreamp(): Promise<number> {
    return readCmd(this.transport, WireCmd.GetPreamp);
  }

  async setInputPreamp(channel: InputSlot, db: number): Promise<void> {
    return writeCmd(this.transport, WireCmd.SetInputPreamp, db, channel);
  }

  async getInputPreamp(channel: InputSlot): Promise<number> {
    return readCmd(this.transport, WireCmd.GetInputPreamp, channel);
  }

  async setMasterVolume(db: number): Promise<void> {
    return writeCmd(this.transport, WireCmd.SetMasterVolume, db);
  }

  async getMasterVolume(): Promise<number> {
    return readCmd(this.transport, WireCmd.GetMasterVolume);
  }

  async setMasterVolumeMode(mode: MasterVolumeMode): Promise<void> {
    return writeCmd(this.transport, WireCmd.SetMasterVolumeMode, mode);
  }

  async getMasterVolumeMode(): Promise<MasterVolumeMode> {
    return readCmd(this.transport, WireCmd.GetMasterVolumeMode);
  }

  async getSavedMasterVolume(): Promise<number> {
    return readCmd(this.transport, WireCmd.GetSavedMasterVolume);
  }

  // Action-style IN: persists live master volume to flash, returns 1-byte
  // PresetResult status. 0 = ok. WebUSB transfer failures throw, so the
  // host-side surface is a simple boolean.
  async saveMasterVolume(): Promise<boolean> {
    const r = await this.transport.ctrlIn(WireCmd.SaveMasterVolume.code, 0, 1);
    return r.length >= 1 && r[0] === 0;
  }

  // Matrix mixer ----------------------------------------------------------
  // SetMatrixRoute always sends the full crosspoint state (enabled+invert+
  // gainDb) -- callers must merge any patch with current snapshot values
  // before calling. GetMatrixRoute packs input/output into wValue since
  // our transport surface only exposes wValue (no wIndex).

  async setMatrixRoute(
    input: InputSlot,
    output: OutputSlot,
    p: { enabled: boolean; invert: boolean; gainDb: number },
  ): Promise<void> {
    return writeCmd(this.transport, WireCmd.SetMatrixRoute, {
      input, output,
      enabled: p.enabled,
      phaseInvert: p.invert,
      gainDb: p.gainDb,
    });
  }

  async getMatrixRoute(
    input: InputSlot,
    output: OutputSlot,
  ): Promise<{ enabled: boolean; invert: boolean; gainDb: number }> {
    const wValue = ((input & 0xFF) << 8) | (output & 0xFF);
    const r = await readCmd(this.transport, WireCmd.GetMatrixRoute, wValue);
    return { enabled: r.enabled, invert: r.phaseInvert, gainDb: r.gainDb };
  }

  async setOutputEnable(output: OutputSlot, on: boolean): Promise<void> {
    return writeCmd(this.transport, WireCmd.SetOutputEnable, on, output);
  }

  async getOutputEnable(output: OutputSlot): Promise<boolean> {
    return readCmd(this.transport, WireCmd.GetOutputEnable, output);
  }

  async setOutputGain(output: OutputSlot, db: number): Promise<void> {
    return writeCmd(this.transport, WireCmd.SetOutputGain, db, output);
  }

  async getOutputGain(output: OutputSlot): Promise<number> {
    return readCmd(this.transport, WireCmd.GetOutputGain, output);
  }

  async setOutputMute(output: OutputSlot, mute: boolean): Promise<void> {
    return writeCmd(this.transport, WireCmd.SetOutputMute, mute, output);
  }

  async getOutputMute(output: OutputSlot): Promise<boolean> {
    return readCmd(this.transport, WireCmd.GetOutputMute, output);
  }

  async setOutputDelay(output: OutputSlot, ms: number): Promise<void> {
    return writeCmd(this.transport, WireCmd.SetOutputDelay, ms, output);
  }

  async getOutputDelay(output: OutputSlot): Promise<number> {
    return readCmd(this.transport, WireCmd.GetOutputDelay, output);
  }

  // Channel names ---------------------------------------------------------
  // 32-byte NUL-terminated UTF-8 buffer. wValue carries the channel index
  // (0..NUM_CHANNELS-1). The bulk packet covers the same field; this
  // round-trip exists for granular edits.

  // Names are silently cropped to fit the 31-byte UTF-8 wire budget.
  // Validation (and user-facing errors) belong at the state/UI layer above.
  async setChannelName(channel: ChannelId, name: string): Promise<void> {
    return writeCmd(this.transport, WireCmd.SetChannelName, utf8Truncate(name, CHANNEL_NAME_MAX_LEN), this.#deviceChannel(channel));
  }

  async getChannelName(channel: ChannelId): Promise<string> {
    return readCmd(this.transport, WireCmd.GetChannelName, this.#deviceChannel(channel));
  }

  // Presets ---------------------------------------------------------------
  // Wire surface for the 11-command preset system (0x90–0x9A). See
  // docs/HW-PROFILES.md for the persistence model.

  async getPresetDirectory(): Promise<PresetDirectoryInfo> {
    const bytes = await this.transport.ctrlIn(
      WireCmd.PresetGetDir.code, 0, PresetDirRequestSize,
    );
    // decodePadded zero-extends a legacy 6-byte response to the V12+
    // 7-byte schema; masterVolumeMode then reads 0 (= Independent), which
    // is the correct legacy semantic, not a sentinel.
    const r = Codec.decodePadded(PresetDirectory, bytes);
    return {
      occupiedSlotsSet: occupiedMaskToSet(r.occupiedMask),
      startupMode:      r.startupMode,
      defaultSlot:      r.defaultSlot as PresetSlot,
      lastActiveSlot:   r.lastActiveSlot === 0xFF ? null : (r.lastActiveSlot as PresetSlot),
      includePins:      r.includePins,
      masterVolumeMode: r.masterVolumeMode as MasterVolumeMode,
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
  async getActivePreset(): Promise<PresetSlot | null> {
    const r = await this.transport.ctrlIn(WireCmd.PresetGetActive.code, 0, 1);
    if (r.length < 1) return null;
    const b = r[0];
    if (b === 0xFF || b >= 10) return null;
    return b as PresetSlot;
  }

  // 0x93 / 0x94: 32-byte NUL-terminated UTF-8 name per slot (0..9).
  // Same codec as channel names; wValue carries the slot index.
  // Names are silently cropped at a codepoint boundary to fit the 31-byte
  // wire budget. Slot is a compile-time `PresetSlot`; no runtime guard here.
  async setPresetName(slot: PresetSlot, name: string): Promise<void> {
    return writeCmd(this.transport, WireCmd.PresetSetName, utf8Truncate(name, PRESET_NAME_MAX_LEN), slot);
  }

  async getPresetName(slot: PresetSlot): Promise<string> {
    return readCmd(this.transport, WireCmd.PresetGetName, slot);
  }

  async savePreset(slot: PresetSlot): Promise<Result<void, PresetResult>> {
    return presetResultFromByte(await actionCmd(this.transport, WireCmd.PresetSave, slot));
  }

  async loadPreset(slot: PresetSlot): Promise<Result<void, PresetResult>> {
    return presetResultFromByte(await actionCmd(this.transport, WireCmd.PresetLoad, slot));
  }

  async deletePreset(slot: PresetSlot): Promise<Result<void, PresetResult>> {
    return presetResultFromByte(await actionCmd(this.transport, WireCmd.PresetDelete, slot));
  }

  async setPresetStartup(config: { mode: number; slot: number }): Promise<void> {
    return writeCmd(this.transport, WireCmd.PresetSetStartup, config);
  }

  async getPresetStartup(): Promise<{ mode: number; slot: number }> {
    return readCmd(this.transport, WireCmd.PresetGetStartup);
  }

  async setPresetIncludePins(include: boolean): Promise<void> {
    return writeCmd(this.transport, WireCmd.PresetSetIncludePins, include);
  }

  async getPresetIncludePins(): Promise<boolean> {
    return readCmd(this.transport, WireCmd.PresetGetIncludePins);
  }

  // Convenience: clear every preset slot in order, pacing between deletes
  // so the firmware's deferred main-loop flash erase (~45 ms per slot
  // with interrupts disabled) doesn't drop the next control transfer
  // into a USB blackout window. Mirrors `ClearAllPresets` in
  // DSPiConsole.Usb/DspDevice.cs.
  //
  // Returns the FIRST non-recoverable failure: an empty-slot delete is
  // treated as success because erase is idempotent. `pacingMs` defaults
  // to 50 (matches .NET reference); pass `0` in tests.
  async clearAllPresets(opts: { pacingMs?: number } = {}): Promise<Result<void, PresetResult>> {
    const pacingMs = opts.pacingMs ?? 50;
    for (let slot = 0 as PresetSlot; slot < 10; slot = (slot + 1) as PresetSlot) {
      const r = await this.deletePreset(slot);
      if (!r.ok && r.code !== PresetResult.SlotEmpty) {
        return r;
      }
      if (slot < 9 && pacingMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, pacingMs));
      }
    }
    return { ok: true, value: undefined };
  }

  // Loudness ---------------------------------------------------------------

  async setLoudnessEnabled(enabled: boolean): Promise<void> {
    return writeCmd(this.transport, WireCmd.SetLoudnessEnabled, enabled);
  }

  async setLoudnessRefSpl(db: number): Promise<void> {
    return writeCmd(this.transport, WireCmd.SetLoudnessRefSpl, db);
  }

  async setLoudnessIntensity(pct: number): Promise<void> {
    return writeCmd(this.transport, WireCmd.SetLoudnessIntensity, pct);
  }

  // Crossfeed --------------------------------------------------------------

  async setCrossfeedEnabled(enabled: boolean): Promise<void> {
    return writeCmd(this.transport, WireCmd.SetCrossfeedEnabled, enabled);
  }

  async setCrossfeedPreset(preset: CrossfeedPreset): Promise<void> {
    return writeCmd(this.transport, WireCmd.SetCrossfeedPreset, preset);
  }

  async setCrossfeedItd(enabled: boolean): Promise<void> {
    return writeCmd(this.transport, WireCmd.SetCrossfeedItd, enabled);
  }

  async setCrossfeedFreq(hz: number): Promise<void> {
    return writeCmd(this.transport, WireCmd.SetCrossfeedFreq, hz);
  }

  async setCrossfeedFeedDb(db: number): Promise<void> {
    return writeCmd(this.transport, WireCmd.SetCrossfeedFeedDb, db);
  }

  // Volume Leveller --------------------------------------------------------

  async setLevellerEnabled(enabled: boolean): Promise<void> {
    return writeCmd(this.transport, WireCmd.SetLevellerEnabled, enabled);
  }

  async setLevellerSpeed(speed: LevellerSpeed): Promise<void> {
    return writeCmd(this.transport, WireCmd.SetLevellerSpeed, speed);
  }

  async setLevellerLookahead(enabled: boolean): Promise<void> {
    return writeCmd(this.transport, WireCmd.SetLevellerLookahead, enabled);
  }

  async setLevellerAmount(pct: number): Promise<void> {
    return writeCmd(this.transport, WireCmd.SetLevellerAmount, pct);
  }

  async setLevellerMaxGain(db: number): Promise<void> {
    return writeCmd(this.transport, WireCmd.SetLevellerMaxGain, db);
  }

  async setLevellerGate(db: number): Promise<void> {
    return writeCmd(this.transport, WireCmd.SetLevellerGate, db);
  }
}
