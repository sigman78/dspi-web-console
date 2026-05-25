import type { DspTransport } from '@/transport/DspTransport';
import { DspDevice } from './DspDevice';
import * as proto from '@/protocol';
import { Codec, utf8Truncate, type Result } from '@/utils';
import * as domain from '@/domain';

// Per-parameter read/write commands used only in tests (HIL and unit), never
// in production runtime. Production keeps the lean DspDevice surface.
export class DspDeviceGranular extends DspDevice {
  static async create(
    transport: DspTransport,
    openTransport: () => Promise<void> = () => transport.open(),
  ): Promise<DspDeviceGranular> {
    const info = await DspDeviceGranular.resolveInfo(transport, openTransport);
    return new DspDeviceGranular(transport, info);
  }

  // EQ ---------------------------------------------------------------------

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

  // Bypass -----------------------------------------------------------------

  async setBypass(enabled: boolean): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetBypass, enabled);
  }

  async getBypass(): Promise<boolean> {
    return proto.readCmd(this.transport, proto.WireCmd.GetBypass);
  }

  // Preamps / master volume ------------------------------------------------

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

  // Matrix mixer ----------------------------------------------------------
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

  // Channel names ---------------------------------------------------------

  // Names are silently cropped to fit the 31-byte UTF-8 wire budget;
  // validation and user-facing errors belong at the state/UI layer above.
  async setChannelName(channel: domain.ChannelId, name: string): Promise<void> {
    const wireChannel = this.deviceChannel(channel);
    return proto.writeCmd(this.transport, proto.WireCmd.SetChannelName, utf8Truncate(name, domain.CHANNEL_NAME_MAX_LEN), wireChannel);
  }

  async getChannelName(channel: domain.ChannelId): Promise<string> {
    return proto.readCmd(this.transport, proto.WireCmd.GetChannelName, this.deviceChannel(channel));
  }

  // Preset read-side granular ---------------------------------------------

  async getPresetStartup(): Promise<{ mode: number; slot: number }> {
    return proto.readCmd(this.transport, proto.WireCmd.PresetGetStartup);
  }

  async getPresetIncludePins(): Promise<boolean> {
    return proto.readCmd(this.transport, proto.WireCmd.PresetGetIncludePins);
  }

  // Persistence ----------------------------------------------------------

  async saveParams(): Promise<Result<void, proto.FlashResult>> {
    return proto.flashResultFromByte(await proto.actionCmd(this.transport, proto.WireCmd.SaveParams));
  }

  async loadParams(): Promise<Result<void, proto.FlashResult>> {
    return proto.flashResultFromByte(await proto.actionCmd(this.transport, proto.WireCmd.LoadParams));
  }

  // Telemetry actions -----------------------------------------------------

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

  // Loudness ---------------------------------------------------------------

  async setLoudnessEnabled(enabled: boolean): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetLoudnessEnabled, enabled);
  }

  async setLoudnessRefSpl(db: number): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetLoudnessRefSpl, db);
  }

  async setLoudnessIntensity(pct: number): Promise<void> {
    return proto.writeCmd(this.transport, proto.WireCmd.SetLoudnessIntensity, pct);
  }

  // Crossfeed --------------------------------------------------------------

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

  // Volume Leveller --------------------------------------------------------

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
