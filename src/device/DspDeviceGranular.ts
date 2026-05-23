import type { DspTransport } from '@/transport/DspTransport';
import { DspDevice } from './DspDevice';
import {
  WireCmd, readCmd, writeCmd,
  actionCmd, flashResultFromByte,
  PresetResult, type FlashResult,
} from '@/protocol';
import { Codec, utf8Truncate, type Result } from '@/utils';
import {
  type ChannelId, type InputSlot, type OutputSlot,
  CrossfeedPreset, LevellerSpeed, MasterVolumeMode,
  type PresetSlot, CHANNEL_NAME_MAX_LEN,
  FilterType, type FilterParams,
} from '@/domain';

// DspDeviceGranular extends DspDevice with per-parameter read/write commands
// that are used only in tests (HIL and unit) — never in production runtime
// code. Production keeps the lean DspDevice surface; tests construct this
// subclass to get the granular CRUD facade.
export class DspDeviceGranular extends DspDevice {
  static async create(
    transport: DspTransport,
    openTransport: () => Promise<void> = () => transport.open(),
  ): Promise<DspDeviceGranular> {
    const info = await DspDeviceGranular.resolveInfo(transport, openTransport);
    return new DspDeviceGranular(transport, info);
  }

  // EQ ---------------------------------------------------------------------

  async setFilter(channel: ChannelId, band: number, p: FilterParams): Promise<void> {
    const wireChannel = this.deviceChannel(channel);
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
    const wireChannel = this.deviceChannel(channel);
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

  async getMasterPreamp(): Promise<number> {
    return readCmd(this.transport, WireCmd.GetPreamp);
  }

  async getInputPreamp(channel: InputSlot): Promise<number> {
    return readCmd(this.transport, WireCmd.GetInputPreamp, channel);
  }

  async getMasterVolume(): Promise<number> {
    return readCmd(this.transport, WireCmd.GetMasterVolume);
  }

  async getMasterVolumeMode(): Promise<MasterVolumeMode> {
    return readCmd(this.transport, WireCmd.GetMasterVolumeMode);
  }

  async getSavedMasterVolume(): Promise<number> {
    return readCmd(this.transport, WireCmd.GetSavedMasterVolume);
  }

  // Matrix mixer ----------------------------------------------------------
  // GetMatrixRoute packs input/output into wValue since our transport surface
  // only exposes wValue (no wIndex).

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
    const wireChannel = this.deviceChannel(channel);
    return writeCmd(this.transport, WireCmd.SetChannelName, utf8Truncate(name, CHANNEL_NAME_MAX_LEN), wireChannel);
  }

  async getChannelName(channel: ChannelId): Promise<string> {
    return readCmd(this.transport, WireCmd.GetChannelName, this.deviceChannel(channel));
  }

  // Preset read-side granular ---------------------------------------------

  async getPresetStartup(): Promise<{ mode: number; slot: number }> {
    return readCmd(this.transport, WireCmd.PresetGetStartup);
  }

  async getPresetIncludePins(): Promise<boolean> {
    return readCmd(this.transport, WireCmd.PresetGetIncludePins);
  }

  // Persistence ----------------------------------------------------------

  async saveParams(): Promise<Result<void, FlashResult>> {
    return flashResultFromByte(await actionCmd(this.transport, WireCmd.SaveParams));
  }

  async loadParams(): Promise<Result<void, FlashResult>> {
    return flashResultFromByte(await actionCmd(this.transport, WireCmd.LoadParams));
  }

  // Telemetry actions -----------------------------------------------------

  // 0xB1 IN with wValue=1. Firmware echoes 0x01 on success. Returns the
  // boolean so callers can show a success indicator without leaking the
  // wire-level shape.
  async resetBufferStats(): Promise<boolean> {
    const r = await this.transport.ctrlIn(WireCmd.ResetBufferStats.code, 1, 1);
    return r.length >= 1 && r[0] === 0x01;
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
