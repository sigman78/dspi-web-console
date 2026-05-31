import type { DspTransport, TransportEvent } from './DspTransport';
import { Wire, WireCmd, SystemStatusValue } from '@/protocol';
import {
  synthesizeSystemStatus, synthesizeU32, synthesizeI32,
  synthesizeBufferStats,
} from '@/protocol/syn';
import {
  buildBulkParams, defaultBulkParams, parseBulkParams, type BulkParams,
} from '@/protocol/bulkParser';
import { Codec } from '@/utils';
import {
  PlatformType,
  CrossfeedPreset, LevellerSpeed, MasterVolumeMode,
  type FilterParams,
  type CrossPoint, type OutputState,
} from '@/domain';

export interface MockOptions {
  platform: 'rp2040' | 'rp2350';
  serial?: string;
  // Wire version the mock reports/synthesizes (default 6). For V7-V10 the
  // tail sections are built faithfully via buildBulkParams, so capability
  // gating, read tolerance and the V6-write merge are testable against a
  // newer device with real tail data.
  wireVersion?: number;
  // Firmware version reported by GetPlatform (default 1.0.0). Set alongside
  // wireVersion for a coherent device (e.g. 1.1.4 + V10).
  fwVersion?: { major: number; minor: number; patch: number };
}

// Default crosspoint / output state (mirrors what defaultBulkParams
// initializes for a slot). Materialising them upfront lets Set*
// commands mutate one slice without rebuilding the whole shape every time.
const defaultCrosspoint = (): CrossPoint => ({ enabled: false, invert: false, gainDb: 0 });

// Default BulkParams used to (a) seed #mockState at construction and
// (b) reset live state when LoadPreset hits an empty slot — per
// user_presets_spec.md §REQ_PRESET_LOAD, current firmware applies factory
// defaults instead of returning SlotEmpty.
function defaultMockBulkState(platform: PlatformType): BulkParams {
  const numCh  = platform === PlatformType.RP2350 ? 11 : 7;
  const numOut = platform === PlatformType.RP2350 ? 9  : 5;
  return defaultBulkParams({ platformId: platform, numCh, numOut });
}

// Full snapshot of mutable mock state so PresetSave/Load round-trips every
// field, not just the bulk-packet contents. Defined outside the class because
// TypeScript doesn't allow interface declarations inside class bodies.
interface MockSnapshot {
  bulk: BulkParams;
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
  #notifyQueue: Uint8Array[] = [];
  #serial: string;
  #platform: PlatformType;
  #wireVersion: number;
  #fwMajor: number;
  #fwMinorPatch: number;
  #masterVolumeDb = 0;
  #masterPreampDb = 0;
  #inputPreampDb: [number, number] = [0, 0];
  #bypass = false;
  #masterVolumeMode: MasterVolumeMode = MasterVolumeMode.Independent;
  #savedMasterVolumeDb = 0;
  #mockState: BulkParams;
  #channelNames: string[] = Array.from({ length: Wire.Const.NUM_CHANNELS }, () => '');

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

  // Latched clip bitmask. Seeded with a demo pattern so the CLEAR button +
  // per-channel clip indicators have something visible to drive under mock:
  //   bit 1 → In1R   (right of the input pair — shows in TabBar)
  //   bit 4 → Out2L  (left of Out2 pair — shows in TabBar, Overview, System)
  // Real firmware latches the clip on overflow; ClearClips (0x83) clears it.
  // The mock mirrors that semantic: clip stays asserted across polls, and
  // the CLEAR button zeroes it on the next status read.
  #clipFlags = 0b0001_0010;

  constructor(opts: MockOptions) {
    this.#serial = opts.serial ?? `MOCK-${opts.platform.toUpperCase()}-0001`;
    this.#platform = opts.platform === 'rp2040' ? PlatformType.RP2040 : PlatformType.RP2350;
    this.#wireVersion = opts.wireVersion ?? 6;
    const fw = opts.fwVersion ?? { major: 1, minor: 0, patch: 0 };
    this.#fwMajor = fw.major;
    this.#fwMinorPatch = ((fw.minor & 0xF) << 4) | (fw.patch & 0xF);
    // Pre-allocate output / crosspoint slots so per-command Set*'s can
    // index into them without conditional shape building. GetAllParams
    // re-synthesises from this state, so mutations show up in the next
    // bulk read -- i.e. the post-mutation resync sees the change.
    this.#mockState = defaultMockBulkState(this.#platform);
    // Override the all-zero defaults with realistic pin/I2S values so granular
    // pin/type tests start from a valid hardware state.
    const numPin = this.#platform === PlatformType.RP2350 ? 5 : 3;
    this.#mockState.numPinOutputs = numPin;
    this.#mockState.pins = (this.#platform === PlatformType.RP2350
      ? [6, 7, 8, 9, 10]
      : [6, 7, 10, 0, 0]);
    this.#mockState.i2s = {
      outputSlotTypes: [0, 0, 0, 0],
      bckPin: 14, mckPin: 13, mckEnabled: false, mckMultiplierEncoded: 0,
    };
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

  // Test helper: enqueue a raw notify packet for the next notifyIn().
  pushNotify(bytes: Uint8Array): void {
    this.#notifyQueue.push(bytes);
  }

  async notifyIn(length: number): Promise<Uint8Array> {
    this.#requireOpen();
    const next = this.#notifyQueue.shift();
    if (next) return next.subarray(0, Math.min(length, next.byteLength));
    return new Uint8Array([0x00]);   // idle keep-alive
  }

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
        const out = new Uint8Array(length);
        out[0] = this.#platform;
        if (length > 1) out[1] = this.#fwMajor;
        if (length > 2) out[2] = this.#fwMinorPatch;
        return out;
      }
      case WireCmd.GetAllParams.code: {
        const bulk = this.#synthBulkPacket();
        return bulk.slice(0, Math.min(length, bulk.byteLength));
      }
      case WireCmd.GetMasterVolume.code:
        return Codec.encode(Codec.f32, this.#mockState.masterVolumeDb);
      case WireCmd.GetPreamp.code:
        return Codec.encode(Codec.f32, this.#mockState.preampDb);
      case WireCmd.GetInputPreamp.code: {
        const idx = (value & 0xFF) === 1 ? 1 : 0;
        return Codec.encode(Codec.f32, idx === 1 ? this.#mockState.preampRDb : this.#mockState.preampLDb);
      }
      case WireCmd.GetMatrixRoute.code: {
        const input = (value >> 8) & 0xFF;
        const output = value & 0xFF;
        const cp = this.#mockState.crosspoints?.[input]?.[output] ?? defaultCrosspoint();
        return Codec.encode(WireCmd.GetMatrixRoute.codec, {
          input, output,
          enabled: cp.enabled,
          phaseInvert: cp.invert,
          gainDb: cp.gainDb,
        });
      }
      case WireCmd.GetOutputEnable.code:
        return Codec.encode(Codec.bool8, this.#output(value).enabled);
      case WireCmd.GetOutputGain.code:
        return Codec.encode(Codec.f32, this.#output(value).gainDb);
      case WireCmd.GetOutputMute.code:
        return Codec.encode(Codec.bool8, this.#output(value).muted);
      case WireCmd.GetOutputDelay.code:
        return Codec.encode(Codec.f32, this.#output(value).delayMs);
      case WireCmd.GetBypass.code:
        return Codec.encode(Codec.bool8, this.#mockState.bypass);
      case WireCmd.GetMasterVolumeMode.code:
        return Codec.encode(Codec.u8, this.#masterVolumeMode);
      case WireCmd.GetSavedMasterVolume.code:
        return Codec.encode(Codec.f32, this.#savedMasterVolumeDb);
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
          case 0: return Codec.encode(Codec.u32, f.type);       // Type widens to u32 on the wire
          case 1: return Codec.encode(Codec.f32, f.frequency);
          case 2: return Codec.encode(Codec.f32, f.q);
          case 3: return Codec.encode(Codec.f32, f.gain);
          default: return new Uint8Array(length);
        }
      }
      case WireCmd.GetBandBypass.code: {
        const ch = (value >> 8) & 0xFF;
        const band = value & 0xFF;
        return Codec.encode(Codec.bool8, this.#mockState.filters?.[ch]?.[band]?.bypass ?? false);
      }
      case WireCmd.GetUserVolume.code:
        return Codec.encode(Codec.f32, this.#mockState.userVolume.volumeDb);
      case WireCmd.GetUserMute.code:
        return Codec.encode(Codec.bool8, this.#mockState.userVolume.mute);
      case WireCmd.GetInputSource.code:
        return Codec.encode(Codec.u8, this.#mockState.inputConfig.source);
      case WireCmd.GetSpdifRxStatus.code:
        return Codec.encode(Wire.SpdifRxStatus, {
          state: 2, inputSource: this.#mockState.inputConfig.source,
          lockCount: 1, lossCount: 0, sampleRate: 48000, parityErrors: 0, fifoFillPct: 50,
        });
      case WireCmd.GetSpdifRxChStatus.code:
        return new Uint8Array(Wire.SPDIF_RX_CH_STATUS_LEN);
      case WireCmd.GetSpdifRxPin.code:
        return Codec.encode(Codec.u8, this.#mockState.inputConfig.spdifRxPin);
      case WireCmd.GetLgSoundSyncEnabled.code:
        return Codec.encode(Codec.bool8, this.#mockState.lgSoundSync.enabled);
      case WireCmd.GetLgSoundSyncStatus.code:
        return Codec.encode(Wire.LgSoundSync, this.#mockState.lgSoundSync);
      case WireCmd.GetDacHwMute.code:
        return Codec.encode(Wire.DacHwMute, this.#mockState.dacHwMute);
      case WireCmd.GetChannelName.code: {
        const ch = value & 0xFF;
        const name = this.#mockState.channelNames[ch] ?? '';
        return Codec.encode(WireCmd.GetChannelName.codec, name);
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
        return Codec.encode(WireCmd.PresetGetStartup.codec, {
          mode: this.#presetStartupMode,
          slot: this.#presetDefaultSlot,
        });
      case WireCmd.PresetGetIncludePins.code:
        return Codec.encode(Codec.bool8, this.#presetIncludePins);
      case WireCmd.PresetGetActive.code:
        return new Uint8Array([this.#presetActiveSlot]);
      case WireCmd.PresetGetName.code: {
        const slot = value & 0xFF;
        const name = (slot < this.#presetNames.length ? this.#presetNames[slot] : '') ?? '';
        return Codec.encode(WireCmd.PresetGetName.codec, name);
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
      case WireCmd.GetOutputPin.code:
        return new Uint8Array([this.#mockState.pins[value & 0xFF] ?? 0]);
      case WireCmd.SetOutputPin.code: {
        const idx = value & 0xFF;
        const pin = (value >> 8) & 0xFF;
        let status = 0x00;
        if (idx >= this.#mockState.numPinOutputs) status = 0x03;
        else if (!this.#isValidGpio(pin)) status = 0x01;
        else if (this.#pinInUse(pin, idx)) status = 0x02;
        else this.#mockState.pins[idx] = pin;
        return new Uint8Array([status]);
      }
      case WireCmd.GetOutputType.code:
        return new Uint8Array([this.#mockState.i2s.outputSlotTypes[value & 0xFF] ?? 0]);
      case WireCmd.SetOutputType.code: {
        const slot = value & 0xFF;
        const type = (value >> 8) & 0xFF;
        let status = 0x00;
        if (slot >= this.#numSpdif()) status = 0x03;
        else if (type > 1) status = 0x01;
        else this.#mockState.i2s.outputSlotTypes[slot] = type;
        return new Uint8Array([status]);
      }
      case WireCmd.GetI2sBckPin.code:
        return new Uint8Array([this.#mockState.i2s.bckPin]);
      case WireCmd.SetI2sBckPin.code: {
        const pin = value & 0xFF;
        let status = 0x00;
        if (!this.#isValidGpio(pin) || !this.#isValidGpio(pin + 1)) status = 0x01;
        else if (this.#mockState.i2s.outputSlotTypes.some((type) => type === 1)) status = 0x04;
        else if (this.#pinInUse(pin, 0xFF) || this.#pinInUse(pin + 1, 0xFF)) status = 0x02;
        else this.#mockState.i2s.bckPin = pin;
        return new Uint8Array([status]);
      }
      case WireCmd.GetMckEnable.code:
        return new Uint8Array([this.#mockState.i2s.mckEnabled ? 1 : 0]);
      case WireCmd.SetMckEnable.code:
        this.#mockState.i2s.mckEnabled = (value & 0xFF) !== 0;
        return new Uint8Array([0x00]);
      case WireCmd.GetMckPin.code:
        return new Uint8Array([this.#mockState.i2s.mckPin]);
      case WireCmd.SetMckPin.code: {
        const pin = value & 0xFF;
        let status = 0x00;
        if (!this.#isValidGpio(pin)) status = 0x01;
        else if (this.#mockState.i2s.mckEnabled) status = 0x04;
        else if (this.#pinInUse(pin, 0xFF)) status = 0x02;
        else this.#mockState.i2s.mckPin = pin;
        return new Uint8Array([status]);
      }
      case WireCmd.GetMckMultiplier.code:
        return new Uint8Array([this.#mockState.i2s.mckMultiplierEncoded]);
      case WireCmd.SetMckMultiplier.code: {
        const raw = value & 0xFF;
        if (raw > 1) return new Uint8Array([0x01]);
        this.#mockState.i2s.mckMultiplierEncoded = raw;
        return new Uint8Array([0x00]);
      }
      case WireCmd.GetBufferStats.code:
        return synthesizeBufferStats({
          numSpdif: this.#numSpdif(),
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
        this.#masterVolumeDb = Codec.decode(Codec.f32, data);
        this.#mockState.masterVolumeDb = this.#masterVolumeDb;
        return;
      case WireCmd.SetPreamp.code:
        this.#masterPreampDb = Codec.decode(Codec.f32, data);
        this.#mockState.preampDb = this.#masterPreampDb;
        return;
      case WireCmd.SetInputPreamp.code: {
        const idx = (value & 0xFF) === 1 ? 1 : 0;
        this.#inputPreampDb[idx] = Codec.decode(Codec.f32, data);
        if (idx === 1) this.#mockState.preampRDb = this.#inputPreampDb[idx];
        else this.#mockState.preampLDb = this.#inputPreampDb[idx];
        return;
      }
      case WireCmd.SetEqParam.code: {
        const p = Codec.decode(Wire.SetFilterPacket, data);
        const row = this.#mockState.filters?.[p.channel];
        if (row && row[p.band]) {
          row[p.band] = {
            type: p.type as FilterParams['type'],
            bypass: row[p.band].bypass,
            frequency: p.frequency,
            q: p.q,
            gain: p.gain,
          };
        }
        return;
      }
      case WireCmd.SetBandBypass.code: {
        const ch = (value >> 8) & 0xFF;
        const band = value & 0xFF;
        const row = this.#mockState.filters?.[ch];
        if (row && row[band]) row[band] = { ...row[band], bypass: Codec.decode(Codec.bool8, data) };
        return;
      }
      case WireCmd.SetUserVolume.code:
        this.#mockState.userVolume.volumeDb = Codec.decode(Codec.f32, data);
        return;
      case WireCmd.SetUserMute.code:
        this.#mockState.userVolume.mute = Codec.decode(Codec.bool8, data);
        return;
      case WireCmd.SetInputSource.code:
        this.#mockState.inputConfig.source = Codec.decode(Codec.u8, data);
        return;
      case WireCmd.SetSpdifRxPin.code:
        this.#mockState.inputConfig.spdifRxPin = value & 0xFF;
        return;
      case WireCmd.SetLgSoundSyncEnabled.code:
        this.#mockState.lgSoundSync.enabled = Codec.decode(Codec.bool8, data);
        return;
      case WireCmd.SetDacHwMute.code: {
        const w = Codec.decode(Wire.DacHwMute, data);
        this.#mockState.dacHwMute = {
          enabled: w.enabled, activeLow: w.activeLow, pin: w.pin, holdMs: w.holdMs, releaseMs: w.releaseMs,
        };
        return;
      }
      case WireCmd.TestDacHwMute.code:
        return; // no-op: firmware pulses the pin
      case WireCmd.SetMatrixRoute.code: {
        const p = Codec.decode(WireCmd.SetMatrixRoute.codec, data);
        const row = this.#mockState.crosspoints![p.input];
        if (row) row[p.output] = { enabled: p.enabled, invert: p.phaseInvert, gainDb: p.gainDb };
        return;
      }
      case WireCmd.SetOutputEnable.code:
        this.#output(value).enabled = Codec.decode(Codec.bool8, data);
        return;
      case WireCmd.SetOutputGain.code:
        this.#output(value).gainDb = Codec.decode(Codec.f32, data);
        return;
      case WireCmd.SetOutputMute.code:
        this.#output(value).muted = Codec.decode(Codec.bool8, data);
        return;
      case WireCmd.SetOutputDelay.code:
        this.#output(value).delayMs = Codec.decode(Codec.f32, data);
        return;
      case WireCmd.SetBypass.code:
        this.#bypass = Codec.decode(Codec.bool8, data);
        this.#mockState.bypass = this.#bypass;
        return;
      case WireCmd.SetMasterVolumeMode.code:
        this.#masterVolumeMode = Codec.decode(Codec.u8, data) as MasterVolumeMode;
        return;

      // Loudness
      case WireCmd.SetLoudnessEnabled.code:
        this.#mockState.loudness!.enabled = Codec.decode(Codec.bool8, data);
        return;
      case WireCmd.SetLoudnessRefSpl.code:
        this.#mockState.loudness!.refSpl = Codec.decode(Codec.f32, data);
        return;
      case WireCmd.SetLoudnessIntensity.code:
        this.#mockState.loudness!.intensityPct = Codec.decode(Codec.f32, data);
        return;

      // Crossfeed
      case WireCmd.SetCrossfeedEnabled.code:
        this.#mockState.crossfeed!.enabled = Codec.decode(Codec.bool8, data);
        return;
      case WireCmd.SetCrossfeedPreset.code:
        this.#mockState.crossfeed!.preset = Codec.decode(Codec.u8, data) as CrossfeedPreset;
        return;
      case WireCmd.SetCrossfeedItd.code:
        this.#mockState.crossfeed!.itd = Codec.decode(Codec.bool8, data);
        return;
      case WireCmd.SetCrossfeedFreq.code:
        this.#mockState.crossfeed!.freq = Codec.decode(Codec.f32, data);
        return;
      case WireCmd.SetCrossfeedFeedDb.code:
        this.#mockState.crossfeed!.feedDb = Codec.decode(Codec.f32, data);
        return;

      // Leveller
      case WireCmd.SetLevellerEnabled.code:
        this.#mockState.leveller!.enabled = Codec.decode(Codec.bool8, data);
        return;
      case WireCmd.SetLevellerSpeed.code:
        this.#mockState.leveller!.speed = Codec.decode(Codec.u8, data) as LevellerSpeed;
        return;
      case WireCmd.SetLevellerLookahead.code:
        this.#mockState.leveller!.lookahead = Codec.decode(Codec.bool8, data);
        return;
      case WireCmd.SetLevellerAmount.code:
        this.#mockState.leveller!.amount = Codec.decode(Codec.f32, data);
        return;
      case WireCmd.SetLevellerMaxGain.code:
        this.#mockState.leveller!.maxGainDb = Codec.decode(Codec.f32, data);
        return;
      case WireCmd.SetLevellerGate.code:
        this.#mockState.leveller!.gateDb = Codec.decode(Codec.f32, data);
        return;

      case WireCmd.SetChannelName.code: {
        const ch = value & 0xFF;
        if (ch < Wire.Const.NUM_CHANNELS) {
          this.#channelNames[ch] = Codec.decode(WireCmd.SetChannelName.codec, data);
          this.#mockState.channelNames[ch] = this.#channelNames[ch];
        }
        return;
      }

      case WireCmd.PresetSetName.code: {
        const slot = value & 0xFF;
        if (slot < this.#presetNames.length) {
          this.#presetNames[slot] = Codec.decode(WireCmd.PresetSetName.codec, data);
        }
        return;
      }

      case WireCmd.PresetSetStartup.code: {
        const cfg = Codec.decode(WireCmd.PresetSetStartup.codec, data);
        this.#presetStartupMode = cfg.mode;
        this.#presetDefaultSlot = cfg.slot;
        return;
      }
      case WireCmd.PresetSetIncludePins.code:
        this.#presetIncludePins = Codec.decode(Codec.bool8, data);
        return;

      case WireCmd.ClearClips.code:
        this.#clipFlags = 0;
        return;

      case WireCmd.SetAllParams.code: {
        this.#applyBulkState(parseBulkParams(data));
        return;
      }

      default:
        return;
    }
  }

  #captureSnapshot(): MockSnapshot {
    return {
      bulk: JSON.parse(JSON.stringify(this.#mockState)) as BulkParams,
      masterVolumeDb: this.#masterVolumeDb,
      masterPreampDb: this.#masterPreampDb,
      inputPreampDb: [this.#inputPreampDb[0], this.#inputPreampDb[1]],
      bypass: this.#bypass,
      savedMasterVolumeDb: this.#savedMasterVolumeDb,
      channelNames: [...this.#channelNames],
    };
  }

  // Build the bulk packet at the configured wire version from #mockState.
  // For V6-V10 the tail is real (buildBulkParams emits it). For a sub-V6
  // reject-path mock we still build a V6 body but report the true (sub-V6)
  // version in the header so the connect-reject path is exercised.
  #synthBulkPacket(): Uint8Array {
    const buildVer = Math.min(Math.max(this.#wireVersion, 6), Wire.MAX_WIRE_VERSION);
    const out = buildBulkParams(this.#mockState, buildVer);
    const dv = new DataView(out.buffer);
    dv.setUint8(0, this.#wireVersion);        // report true version (may be < 6)
    dv.setUint16(6, out.byteLength, true);    // payloadLength
    return out;
  }

  #applyBulkState(bulk: BulkParams): void {
    this.#mockState = bulk;
    this.#masterVolumeDb = bulk.masterVolumeDb;
    this.#masterPreampDb = bulk.preampDb;
    this.#inputPreampDb = [bulk.preampLDb, bulk.preampRDb];
    this.#bypass = bulk.bypass;
    this.#channelNames = bulk.channelNames.slice(0, Wire.Const.NUM_CHANNELS);
  }

  // Reset live state to factory defaults. Used by empty-slot PresetLoad
  // (per spec §REQ_PRESET_LOAD: load on empty slot applies factory
  // defaults; PRESET_ERR_SLOT_EMPTY is reserved). Scalars revert to the
  // mock's constructor defaults; channel names clear.
  #resetLiveToDefaults(): void {
    this.#applyBulkState(defaultMockBulkState(this.#platform));
    this.#savedMasterVolumeDb = 0;
  }

  #restoreSnapshot(s: MockSnapshot): void {
    this.#mockState = JSON.parse(JSON.stringify(s.bulk)) as BulkParams;
    // Per HW-PROFILES §3: master volume *value* rides the preset payload
    // only in Mode 1 (with-preset). In Mode 0 (independent), LoadPreset
    // leaves master volume alone — it's owned by the directory sector,
    // restored via GetSavedMasterVolume on boot. The mock checks the
    // *current* (live) mode, matching the firmware's runtime decision.
    // Mode itself is global and is NOT part of the preset payload, so
    // it's intentionally absent from MockSnapshot.
    if (this.#masterVolumeMode === MasterVolumeMode.WithPreset) {
      this.#masterVolumeDb = s.masterVolumeDb;
      this.#mockState.masterVolumeDb = s.masterVolumeDb;
    } else {
      this.#mockState.masterVolumeDb = this.#masterVolumeDb;
    }
    this.#masterPreampDb = s.masterPreampDb;
    this.#inputPreampDb = [s.inputPreampDb[0], s.inputPreampDb[1]];
    this.#bypass = s.bypass;
    this.#savedMasterVolumeDb = s.savedMasterVolumeDb;
    this.#channelNames = [...s.channelNames];
    this.#mockState.preampDb = this.#masterPreampDb;
    this.#mockState.preampLDb = this.#inputPreampDb[0];
    this.#mockState.preampRDb = this.#inputPreampDb[1];
    this.#mockState.bypass = this.#bypass;
    this.#mockState.channelNames = [...this.#channelNames];
  }

  // Resolve the OutputState slot for a wValue-encoded output index. Returns
  // a writable reference into #mockState so callers can mutate fields in
  // place.
  #output(wValue: number): OutputState {
    return this.#mockState.outputs![wValue & 0xFF];
  }

  #numSpdif(): number {
    return this.#platform === PlatformType.RP2350 ? 4 : 2;
  }

  #isValidGpio(pin: number): boolean {
    if (pin === 12 || (pin >= 23 && pin <= 25)) return false;
    return pin >= 0 && pin <= (this.#platform === PlatformType.RP2350 ? 29 : 28);
  }

  #pinInUse(pin: number, excludeIdx: number): boolean {
    const pins = this.#mockState.pins;
    for (let i = 0; i < this.#mockState.numPinOutputs; i++) {
      if (i === excludeIdx) continue;
      if (pins[i] === pin) return true;
    }
    const i2s = this.#mockState.i2s;
    if (i2s.outputSlotTypes.some((type) => type === 1) && (pin === i2s.bckPin || pin === i2s.bckPin + 1)) return true;
    if (i2s.mckEnabled && pin === i2s.mckPin) return true;
    return false;
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
        return synthesizeSystemStatus({ numCh, peaks, cpu0: 25, cpu1: 12, clipFlags: this.#clipFlags });
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
