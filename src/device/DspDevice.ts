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
  MasterVolumeMode,
  type PresetSlot, PRESET_NAME_MAX_LEN, PRESET_SLOT_COUNT,
  type PresetDirectoryInfo,
  type DspSnapshot,
} from '@/domain';
import { fromBulkParams, toBulkParams, type DeviceState } from './snapshotCodec';

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
      readCmd(transport, WireCmd.GetSerial),
      readCmd(transport, WireCmd.GetPlatform),
    ]);
    const platformType = platformTypeFromId(platform.platformId);
    const hardware = createHardwareProfile(platformType);
    return {
      serial: serial.trim(),
      firmwareVersion: firmwareVersion(platform),
      platformType,
      hardware,
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

  get hardware(): HardwareProfile {
    return this._info.hardware;
  }

  protected deviceChannel(channel: ChannelId): ChannelId {
    return wireChannelFor(this.hardware, channel);
  }

  #wireBase: BulkParams | null = null;

  // True once the device has fetched at least one packet; guards optimistic
  // bulk writes during the connect race (a write before the first snapshot has
  // no base packet to overlay).
  get hasState(): boolean {
    return this.#wireBase !== null;
  }

  // Snapshot-out: fetch the wire packet, retain it as the overlay base, return
  // the domain view. The sole app-facing read path.
  async getSnapshot(): Promise<DspSnapshot> {
    const bulk = await this.getAllParams();
    this.#wireBase = bulk;
    return fromBulkParams(this.hardware, bulk);
  }

  // Snapshot-in: overlay the draft onto the retained base packet and push it,
  // then retain the just-sent packet as the new base.
  async applyBulk(draft: DspSnapshot): Promise<void> {
    if (!this.#wireBase) throw new Error('applyBulk before getSnapshot: no wire base');
    const bulk = toBulkParams(this.hardware, draft, this.#wireBase);
    await this.setAllParams(bulk);
    this.#wireBase = bulk;
  }

  // Opaque capture for the device-to-device paste copy. Always performs a fresh
  // wire fetch; the result may differ from the last getSnapshot/applyBulk if the
  // device state changed concurrently. Deliberately does NOT update #wireBase.
  async captureState(): Promise<DeviceState> {
    return (await this.getAllParams()) as DeviceState;
  }

  async restoreState(state: DeviceState): Promise<void> {
    await this.setAllParams(state);
    this.#wireBase = state;
  }

  async getAllParams(): Promise<BulkParams> {
    const bytes = await this.transport.ctrlIn(WireCmd.GetAllParams.code, 0, Wire.BulkLimits.MaxRequestSize);
    return parseBulkParams(bytes);
  }

  // Push a complete DSP state to the device in one transfer (USB control-OUT 0xA1).
  // Wire payload must be exactly 2896 B (V6); firmware STALLs otherwise -- the
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

  async factoryReset(): Promise<Result<void, FlashResult>> {
    return flashResultFromByte(await actionCmd(this.transport, WireCmd.FactoryReset));
  }

  // Telemetry actions -----------------------------------------------------

  // 0x83 OUT, no payload. Clears latched clip flags so they can re-arm.
  async clearClips(): Promise<void> {
    await this.transport.ctrlOut(WireCmd.ClearClips.code, 0, new Uint8Array(0));
  }

  // Preamps / master volume ------------------------------------------------

  async setMasterPreamp(db: number): Promise<void> {
    return writeCmd(this.transport, WireCmd.SetPreamp, db);
  }

  async setInputPreamp(channel: InputSlot, db: number): Promise<void> {
    return writeCmd(this.transport, WireCmd.SetInputPreamp, db, channel);
  }

  async setMasterVolume(db: number): Promise<void> {
    return writeCmd(this.transport, WireCmd.SetMasterVolume, db);
  }

  async setMasterVolumeMode(mode: MasterVolumeMode): Promise<void> {
    return writeCmd(this.transport, WireCmd.SetMasterVolumeMode, mode);
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
  // before calling.

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

  async setOutputGain(output: OutputSlot, db: number): Promise<void> {
    return writeCmd(this.transport, WireCmd.SetOutputGain, db, output);
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

  async setPresetIncludePins(include: boolean): Promise<void> {
    return writeCmd(this.transport, WireCmd.PresetSetIncludePins, include);
  }
}
