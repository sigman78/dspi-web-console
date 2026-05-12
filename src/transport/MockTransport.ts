import type { DspTransport, TransportEvent } from './DspTransport';
import { WireCmd } from '../protocol/wireCmd';
import { synthesizeBulkParams, type SynthesizeOptions } from '../protocol/bulkParser.syn';
import {
  synthesizeSystemStatus,
  synthesizeU32,
  synthesizeI32,
} from '../protocol/systemStatus.syn';
import { synthesizeBufferStats } from '../protocol/bufferStats.syn';
import { Const, SystemStatusValue, SetFilterPacket } from '../protocol/wireTypes';
import { Codec, encode, decode } from '../utils/binCodec';
import { PlatformType } from '../domain/platform';
import { CrossfeedPreset, LevellerSpeed, MasterVolumeMode } from '../domain/processing';
import { defaultFilter, type FilterParams } from '../domain/filter';
import {
  type CrossPoint,
  type OutputState,
} from '../domain/mixer';

export interface MockOptions {
  platform: 'rp2040' | 'rp2350';
  serial?: string;
}

// Default crosspoint / output state (mirrors what synthesizeBulkParams
// fills in when a slot is missing). Materialising them upfront lets Set*
// commands mutate one slice without rebuilding the whole shape every time.
const defaultCrosspoint = (): CrossPoint => ({ enabled: false, invert: false, gainDb: 0 });
const defaultOutput = (): OutputState => ({ enabled: false, muted: false, gainDb: 0, delayMs: 0 });

// Default SynthesizeOptions used to (a) seed #mockState at construction and
// (b) reset live state when LoadPreset hits an empty slot — per
// user_presets_spec.md §REQ_PRESET_LOAD, current firmware applies factory
// defaults instead of returning SlotEmpty.
function defaultMockBulkState(): SynthesizeOptions {
  return {
    formatVersion: 6,
    outputs: Array.from({ length: Const.NUM_OUTPUTS }, defaultOutput),
    crosspoints: Array.from({ length: Const.NUM_INPUTS }, () =>
      Array.from({ length: Const.NUM_OUTPUTS }, defaultCrosspoint),
    ),
    filters: Array.from({ length: Const.NUM_CHANNELS }, () =>
      Array.from({ length: Const.BANDS_MAX }, defaultFilter),
    ),
    loudness:  { enabled: false, refSpl: 85, intensityPct: 0 },
    crossfeed: { enabled: false, preset: 0, itd: false, freq: 700, feedDb: 4.5 },
    leveller:  { enabled: false, speed: 1, lookahead: false, amount: 0, maxGainDb: 0, gateDb: -40 },
  };
}

// Full snapshot of mutable mock state so PresetSave/Load round-trips every
// field, not just the bulk-packet contents. Defined outside the class because
// TypeScript doesn't allow interface declarations inside class bodies.
interface MockSnapshot {
  bulk: SynthesizeOptions;
  masterVolumeDb: number;
  masterPreampDb: number;
  inputPreampDb: [number, number];
  bypass: boolean;
  savedMasterVolumeDb: number;
  channelNames: string[];
}

export class MockTransport implements DspTransport {
  #open = false;
  #listeners = new Map<TransportEvent, Set<() => void>>();
  #serial: string;
  #platform: PlatformType;
  #masterVolumeDb = 0;
  #masterPreampDb = 0;
  #inputPreampDb: [number, number] = [0, 0];
  #bypass = false;
  #masterVolumeMode: MasterVolumeMode = MasterVolumeMode.Independent;
  #savedMasterVolumeDb = 0;
  #mockState: SynthesizeOptions;
  #channelNames: string[] = Array.from({ length: Const.NUM_CHANNELS }, () => '');

  // Preset directory + 10-slot snapshots. Kept here (rather than in
  // SynthesizeOptions) because the directory metadata is not part of
  // the bulk packet — it's its own wire surface.
  #presetOccupiedMask = 0;
  #presetStartupMode = 0;       // PresetStartupMode.Specified (firmware default)
  #presetDefaultSlot = 0;
  #presetLastActiveSlot = 0;    // always-active default
  #presetIncludePins = true;    // default per HW-PROFILES §0
  #presetActiveSlot = 0;
  // Per-slot names live in the directory sector, not the slot payload — they
  // survive LoadPreset and are deliberately NOT in MockSnapshot. Matches
  // firmware behavior (HW-PROFILES §1b: SetPresetName is independent of save).
  #presetNames: string[] = Array.from({ length: 10 }, () => '');
  // Per-slot full snapshots so PresetSave/Load round-trips every mock field,
  // not just the bulk-packet contents. null = empty slot.
  #presetSlots: (MockSnapshot | null)[] = Array.from({ length: 10 }, () => null);

  constructor(opts: MockOptions) {
    this.#serial = opts.serial ?? `MOCK-${opts.platform.toUpperCase()}-0001`;
    this.#platform = opts.platform === 'rp2040' ? PlatformType.RP2040 : PlatformType.RP2350;
    // Pre-allocate output / crosspoint slots so per-command Set*'s can
    // index into them without conditional shape building. GetAllParams
    // re-synthesises from this state, so mutations show up in the next
    // bulk read -- i.e. the post-mutation resync sees the change.
    this.#mockState = defaultMockBulkState();
  }

  async open(): Promise<void> {
    this.#open = true;
    this.#emit('connect');
  }

  async close(): Promise<void> {
    this.#open = false;
    this.#emit('disconnect');
  }

  isOpen(): boolean { return this.#open; }

  async ctrlIn(request: number, value: number, length: number): Promise<Uint8Array> {
    this.#requireOpen();
    switch (request) {
      case WireCmd.GetSerial.code: {
        const enc = new TextEncoder();
        const out = new Uint8Array(length);
        out.set(enc.encode(this.#serial).slice(0, length));
        return out;
      }
      case WireCmd.GetPlatform.code: {
        // Wire shape: [platformId, fwMajor, (minor<<4)|patch, reserved].
        // Mock reports v1.0.0.
        const out = new Uint8Array(length);
        out[0] = this.#platform;
        if (length > 1) out[1] = 1;
        if (length > 2) out[2] = 0x00;
        return out;
      }
      case WireCmd.GetAllParams.code: {
        const bulk = synthesizeBulkParams(this.#mockState);
        return bulk.slice(0, Math.min(length, bulk.byteLength));
      }
      case WireCmd.GetMasterVolume.code:
        return encode(Codec.f32, this.#masterVolumeDb);
      case WireCmd.GetPreamp.code:
        return encode(Codec.f32, this.#masterPreampDb);
      case WireCmd.GetInputPreamp.code: {
        const idx = (value & 0xFF) === 1 ? 1 : 0;
        return encode(Codec.f32, this.#inputPreampDb[idx]);
      }
      case WireCmd.GetMatrixRoute.code: {
        const input = (value >> 8) & 0xFF;
        const output = value & 0xFF;
        const cp = this.#mockState.crosspoints?.[input]?.[output] ?? defaultCrosspoint();
        return encode(WireCmd.GetMatrixRoute.codec, {
          input, output,
          enabled: cp.enabled,
          phaseInvert: cp.invert,
          gainDb: cp.gainDb,
        });
      }
      case WireCmd.GetOutputEnable.code:
        return encode(Codec.bool8, this.#output(value).enabled);
      case WireCmd.GetOutputGain.code:
        return encode(Codec.f32, this.#output(value).gainDb);
      case WireCmd.GetOutputMute.code:
        return encode(Codec.bool8, this.#output(value).muted);
      case WireCmd.GetOutputDelay.code:
        return encode(Codec.f32, this.#output(value).delayMs);
      case WireCmd.GetBypass.code:
        return encode(Codec.bool8, this.#bypass);
      case WireCmd.GetMasterVolumeMode.code:
        return encode(Codec.u8, this.#masterVolumeMode);
      case WireCmd.GetSavedMasterVolume.code:
        return encode(Codec.f32, this.#savedMasterVolumeDb);
      case WireCmd.SaveMasterVolume.code:
        this.#savedMasterVolumeDb = this.#masterVolumeDb;
        return new Uint8Array([0]); // PresetResult.Ok
      // Action-style IN: just acknowledge with FlashResult.Ok. Real firmware
      // mutates flash + (on V3+) the active slot; this mock doesn't simulate
      // that side effect — preset round-trips go through PresetSave/Load
      // directly instead.
      case WireCmd.SaveParams.code:
      case WireCmd.LoadParams.code:
      case WireCmd.FactoryReset.code:
        return new Uint8Array([0]); // FlashResult.Ok
      case WireCmd.GetEqParam.code: {
        // Bit-packed wValue: (channel << 8) | (band << 4) | param
        const channel = (value >> 8) & 0xFF;
        const band = (value >> 4) & 0xF;
        const param = value & 0xF;
        const f = this.#mockState.filters?.[channel]?.[band];
        if (!f) return new Uint8Array(length);
        switch (param) {
          case 0: return encode(Codec.u32, f.type);       // Type widens to u32 on the wire
          case 1: return encode(Codec.f32, f.frequency);
          case 2: return encode(Codec.f32, f.q);
          case 3: return encode(Codec.f32, f.gain);
          default: return new Uint8Array(length);
        }
      }
      case WireCmd.GetChannelName.code: {
        const ch = value & 0xFF;
        const name = this.#channelNames[ch] ?? '';
        return encode(WireCmd.GetChannelName.codec, name);
      }
      case WireCmd.PresetGetDir.code: {
        const out = new Uint8Array(7);
        const view = new DataView(out.buffer);
        view.setUint16(0, this.#presetOccupiedMask, true);
        out[2] = this.#presetStartupMode;
        out[3] = this.#presetDefaultSlot;
        out[4] = this.#presetLastActiveSlot;
        out[5] = this.#presetIncludePins ? 1 : 0;
        // Same byte as GetMasterVolumeMode (0xD5) — HW-PROFILES §1a: single
        // directory-sector byte; using the live field keeps both read paths in sync.
        out[6] = this.#masterVolumeMode;
        return out.slice(0, Math.min(length, out.byteLength));
      }
      case WireCmd.PresetGetStartup.code:
        return encode(WireCmd.PresetGetStartup.codec, {
          mode: this.#presetStartupMode,
          slot: this.#presetDefaultSlot,
        });
      case WireCmd.PresetGetIncludePins.code:
        return encode(Codec.bool8, this.#presetIncludePins);
      case WireCmd.PresetGetActive.code:
        return new Uint8Array([this.#presetActiveSlot]);
      case WireCmd.PresetGetName.code: {
        const slot = value & 0xFF;
        const name = (slot < this.#presetNames.length ? this.#presetNames[slot] : '') ?? '';
        return encode(WireCmd.PresetGetName.codec, name);
      }
      case WireCmd.PresetSave.code: {
        const slot = value & 0xFF;
        if (slot >= 10) return new Uint8Array([0x01]); // InvalidSlot
        this.#presetSlots[slot] = this.#captureSnapshot();
        this.#presetOccupiedMask |= (1 << slot);
        this.#presetActiveSlot = slot;
        this.#presetLastActiveSlot = slot;
        return new Uint8Array([0]); // Ok
      }
      case WireCmd.PresetLoad.code: {
        const slot = value & 0xFF;
        if (slot >= 10) return new Uint8Array([0x01]); // InvalidSlot
        const snap = this.#presetSlots[slot];
        if (snap) {
          this.#restoreSnapshot(snap);
        } else {
          // Per user_presets_spec.md §REQ_PRESET_LOAD: load on an empty
          // slot applies factory defaults and returns Ok. The historic
          // PRESET_ERR_SLOT_EMPTY (0x02) is now reserved.
          this.#resetLiveToDefaults();
        }
        this.#presetActiveSlot = slot;
        this.#presetLastActiveSlot = slot;
        return new Uint8Array([0]); // Ok
      }
      case WireCmd.PresetDelete.code: {
        const slot = value & 0xFF;
        if (slot >= 10) return new Uint8Array([0x01]); // InvalidSlot
        this.#presetSlots[slot] = null;
        this.#presetOccupiedMask &= ~(1 << slot) & 0xFFFF;
        // NOTE: per user_presets_spec.md §REQ_PRESET_DELETE, the slot name
        // lives in the directory sector and persists through delete. Real
        // firmware does NOT clear it; the mock must mirror that.
        return new Uint8Array([0]); // Ok
      }
      case WireCmd.GetStatus.code: {
        return this.#synthStatus(value, length);
      }
      case WireCmd.ResetBufferStats.code:
        return new Uint8Array([0x01]); // success sentinel
      case WireCmd.GetBufferStats.code:
        return synthesizeBufferStats({
          numSpdif: this.#platform === PlatformType.RP2040 ? 2 : 4,
          pdmActive: true, streaming: true,
          sequence: 1,
          spdif: [
            { consumerFree: 1, consumerPrepared: 2, consumerPlaying: 1,
              consumerFillPct: 60, consumerMinFillPct: 30, consumerMaxFillPct: 80 },
          ],
          pdm: {
            dmaFillPct: 50, dmaMinFillPct: 25, dmaMaxFillPct: 75,
            ringFillPct: 70, ringMinFillPct: 40, ringMaxFillPct: 90,
          },
        });
      default:
        return new Uint8Array(length);
    }
  }

  async ctrlOut(request: number, value: number, data: Uint8Array): Promise<void> {
    this.#requireOpen();
    switch (request) {
      case WireCmd.SetMasterVolume.code:
        this.#masterVolumeDb = decode(Codec.f32, data);
        return;
      case WireCmd.SetPreamp.code:
        this.#masterPreampDb = decode(Codec.f32, data);
        return;
      case WireCmd.SetInputPreamp.code: {
        const idx = (value & 0xFF) === 1 ? 1 : 0;
        this.#inputPreampDb[idx] = decode(Codec.f32, data);
        return;
      }
      case WireCmd.SetEqParam.code: {
        const p = decode(SetFilterPacket, data);
        const row = this.#mockState.filters?.[p.channel];
        if (row && row[p.band]) {
          row[p.band] = {
            type: p.type as FilterParams['type'],
            frequency: p.frequency,
            q: p.q,
            gain: p.gain,
          };
        }
        return;
      }
      case WireCmd.SetMatrixRoute.code: {
        const p = decode(WireCmd.SetMatrixRoute.codec, data);
        const row = this.#mockState.crosspoints![p.input];
        if (row) row[p.output] = { enabled: p.enabled, invert: p.phaseInvert, gainDb: p.gainDb };
        return;
      }
      case WireCmd.SetOutputEnable.code:
        this.#output(value).enabled = decode(Codec.bool8, data);
        return;
      case WireCmd.SetOutputGain.code:
        this.#output(value).gainDb = decode(Codec.f32, data);
        return;
      case WireCmd.SetOutputMute.code:
        this.#output(value).muted = decode(Codec.bool8, data);
        return;
      case WireCmd.SetOutputDelay.code:
        this.#output(value).delayMs = decode(Codec.f32, data);
        return;
      case WireCmd.SetBypass.code:
        this.#bypass = decode(Codec.bool8, data);
        return;
      case WireCmd.SetMasterVolumeMode.code:
        this.#masterVolumeMode = decode(Codec.u8, data) as MasterVolumeMode;
        return;

      // Loudness
      case WireCmd.SetLoudnessEnabled.code:
        this.#mockState.loudness!.enabled = decode(Codec.bool8, data);
        return;
      case WireCmd.SetLoudnessRefSpl.code:
        this.#mockState.loudness!.refSpl = decode(Codec.f32, data);
        return;
      case WireCmd.SetLoudnessIntensity.code:
        this.#mockState.loudness!.intensityPct = decode(Codec.f32, data);
        return;

      // Crossfeed
      case WireCmd.SetCrossfeedEnabled.code:
        this.#mockState.crossfeed!.enabled = decode(Codec.bool8, data);
        return;
      case WireCmd.SetCrossfeedPreset.code:
        this.#mockState.crossfeed!.preset = decode(Codec.u8, data) as CrossfeedPreset;
        return;
      case WireCmd.SetCrossfeedItd.code:
        this.#mockState.crossfeed!.itd = decode(Codec.bool8, data);
        return;
      case WireCmd.SetCrossfeedFreq.code:
        this.#mockState.crossfeed!.freq = decode(Codec.f32, data);
        return;
      case WireCmd.SetCrossfeedFeedDb.code:
        this.#mockState.crossfeed!.feedDb = decode(Codec.f32, data);
        return;

      // Leveller
      case WireCmd.SetLevellerEnabled.code:
        this.#mockState.leveller!.enabled = decode(Codec.bool8, data);
        return;
      case WireCmd.SetLevellerSpeed.code:
        this.#mockState.leveller!.speed = decode(Codec.u8, data) as LevellerSpeed;
        return;
      case WireCmd.SetLevellerLookahead.code:
        this.#mockState.leveller!.lookahead = decode(Codec.bool8, data);
        return;
      case WireCmd.SetLevellerAmount.code:
        this.#mockState.leveller!.amount = decode(Codec.f32, data);
        return;
      case WireCmd.SetLevellerMaxGain.code:
        this.#mockState.leveller!.maxGainDb = decode(Codec.f32, data);
        return;
      case WireCmd.SetLevellerGate.code:
        this.#mockState.leveller!.gateDb = decode(Codec.f32, data);
        return;

      case WireCmd.SetChannelName.code: {
        const ch = value & 0xFF;
        if (ch < Const.NUM_CHANNELS) {
          this.#channelNames[ch] = decode(WireCmd.SetChannelName.codec, data);
        }
        return;
      }

      case WireCmd.PresetSetName.code: {
        const slot = value & 0xFF;
        if (slot < this.#presetNames.length) {
          this.#presetNames[slot] = decode(WireCmd.PresetSetName.codec, data);
        }
        return;
      }

      case WireCmd.PresetSetStartup.code: {
        const cfg = decode(WireCmd.PresetSetStartup.codec, data);
        this.#presetStartupMode = cfg.mode;
        this.#presetDefaultSlot = cfg.slot;
        return;
      }
      case WireCmd.PresetSetIncludePins.code:
        this.#presetIncludePins = decode(Codec.bool8, data);
        return;

      case WireCmd.ClearClips.code:
        return; // no-op for the mock; in real firmware this clears latched clip flags

      default:
        return;
    }
  }

  #captureSnapshot(): MockSnapshot {
    return {
      bulk: JSON.parse(JSON.stringify(this.#mockState)) as SynthesizeOptions,
      masterVolumeDb: this.#masterVolumeDb,
      masterPreampDb: this.#masterPreampDb,
      inputPreampDb: [this.#inputPreampDb[0], this.#inputPreampDb[1]],
      bypass: this.#bypass,
      savedMasterVolumeDb: this.#savedMasterVolumeDb,
      channelNames: [...this.#channelNames],
    };
  }

  // Reset live state to factory defaults. Used by empty-slot PresetLoad
  // (per spec §REQ_PRESET_LOAD: load on empty slot applies factory
  // defaults; PRESET_ERR_SLOT_EMPTY is reserved). Scalars revert to the
  // mock's constructor defaults; channel names clear.
  #resetLiveToDefaults(): void {
    this.#mockState = defaultMockBulkState();
    this.#masterVolumeDb = 0;
    this.#masterPreampDb = 0;
    this.#inputPreampDb = [0, 0];
    this.#bypass = false;
    this.#savedMasterVolumeDb = 0;
    this.#channelNames = Array.from({ length: Const.NUM_CHANNELS }, () => '');
  }

  #restoreSnapshot(s: MockSnapshot): void {
    this.#mockState = JSON.parse(JSON.stringify(s.bulk)) as SynthesizeOptions;
    // Per HW-PROFILES §3: master volume *value* rides the preset payload
    // only in Mode 1 (with-preset). In Mode 0 (independent), LoadPreset
    // leaves master volume alone — it's owned by the directory sector,
    // restored via GetSavedMasterVolume on boot. The mock checks the
    // *current* (live) mode, matching the firmware's runtime decision.
    // Mode itself is global and is NOT part of the preset payload, so
    // it's intentionally absent from MockSnapshot.
    if (this.#masterVolumeMode === MasterVolumeMode.WithPreset) {
      this.#masterVolumeDb = s.masterVolumeDb;
    }
    this.#masterPreampDb = s.masterPreampDb;
    this.#inputPreampDb = [s.inputPreampDb[0], s.inputPreampDb[1]];
    this.#bypass = s.bypass;
    this.#savedMasterVolumeDb = s.savedMasterVolumeDb;
    this.#channelNames = [...s.channelNames];
  }

  // Resolve the OutputState slot for a wValue-encoded output index. Returns
  // a writable reference into #mockState so callers can mutate fields in
  // place.
  #output(wValue: number): OutputState {
    return this.#mockState.outputs![wValue & 0xFF];
  }

  // Dispatch GetStatus by wValue.  See docs/system-status-req.md and
  // SystemStatusValue in protocol/wireTypes.ts.  Returns a fresh buffer
  // sized to whatever the caller requested.
  #synthStatus(wValue: number, length: number): Uint8Array {
    switch (wValue) {
      case SystemStatusValue.CombinedPeaks: {
        // Caller sizes the request: numCh = (length - 4) / 2.
        const numCh = Math.max(0, (length - 4) >> 1);
        const peaks = Array.from({ length: numCh }, (_, i) => (i + 1) / numCh);
        return synthesizeSystemStatus({ numCh, peaks, cpu0: 25, cpu1: 12, clipFlags: 0 });
      }
      // Environment scalars
      case SystemStatusValue.ClockHz:        return synthesizeU32(125_000_000);
      case SystemStatusValue.CoreVoltageMv:  return synthesizeU32(3300);
      case SystemStatusValue.SampleRateHz:   return synthesizeU32(48_000);
      case SystemStatusValue.TempCDegC:      return synthesizeI32(4210);  // 42.10 degC

      // Counters: stay zero in the mock -- real firmware reports cumulative
      // since boot, so the drift behavior is uninteresting offline.
      case SystemStatusValue.PdmRingOverruns:
      case SystemStatusValue.PdmRingUnderruns:
      case SystemStatusValue.PdmDmaOverruns:
      case SystemStatusValue.PdmDmaUnderruns:
      case SystemStatusValue.SpdifOverruns:
      case SystemStatusValue.SpdifUnderruns:
      case SystemStatusValue.SpdifStarvationsTotal:
        return synthesizeU32(0);

      // Unknown / unwired wValue: return a zeroed buffer of requested size.
      default:
        return new Uint8Array(length);
    }
  }

  on(event: TransportEvent, listener: () => void): () => void {
    let set = this.#listeners.get(event);
    if (!set) { set = new Set(); this.#listeners.set(event, set); }
    set.add(listener);
    return () => set!.delete(listener);
  }

  #emit(event: TransportEvent): void {
    this.#listeners.get(event)?.forEach((l) => l());
  }

  #requireOpen(): void {
    if (!this.#open) throw new Error('MockTransport: not open');
  }
}
