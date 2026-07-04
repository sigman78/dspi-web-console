import type { DspTransport, TransportEvent } from './DspTransport';
import { Wire, WireCmd, SystemStatusValue } from '@/protocol';
import {
  synthesizeSystemStatus, synthesizeU32, synthesizeI32,
  synthesizeBufferStats,
} from '@/protocol/syn';
import {
  buildBulkParams, defaultBulkParams, parseBulkParams,
  type BulkParams, type WireFilter,
} from '@/protocol/bulkParser';
import { Codec } from '@/utils';
import {
  PlatformType, OutputSlotType,
  CrossfeedPreset, LevellerSpeed, MasterVolumeMode, OutputConfigMode,
  XOVER_BAND_BASE, MAX_XOVER_BANDS,
  type FilterParams,
  type CrossPoint, type OutputState,
} from '@/domain';

export interface MockOptions {
  platform: 'rp2040' | 'rp2350';
  serial?: string;
  // Wire version the mock reports/synthesizes (default 10 = released 1.1.4).
  // V7-V10 tail sections are built faithfully; pass an older version to
  // simulate a legacy device (e.g. for connect-reject tests).
  wireVersion?: number;
  // Firmware version reported by GetPlatform (default 1.1.4). Set alongside
  // wireVersion for a coherent device (e.g. 1.1.3 + V6).
  fwVersion?: { major: number; minor: number; patch: number };
  // Override the header's payloadLength to simulate a malformed device that
  // reports a truncated payload, exercising the connect truncation guard.
  payloadLength?: number;
}

const defaultCrosspoint = (): CrossPoint => ({ enabled: false, invert: false, gainDb: 0 });

// Seeds #mockState at construction and resets live state on empty-slot
// LoadPreset (firmware applies factory defaults rather than returning SlotEmpty).
// V16 grows the RP2350 to the unified 17-channel space (8 inputs); RP2040
// stays 7-wide on both generations.
function defaultMockBulkState(platform: PlatformType, wireVersion: number): BulkParams {
  const v16 = wireVersion >= 16;
  const numIn  = v16 && platform === PlatformType.RP2350 ? 8 : 2;
  const numOut = platform === PlatformType.RP2350 ? 9 : 5;
  const numCh  = numIn + numOut;
  return defaultBulkParams({
    platformId: platform, numCh, numOut, numIn,
    formatVersion: Math.max(wireVersion, 6),
  });
}

// Full snapshot of mutable mock state so PresetSave/Load round-trips every
// field, not just the bulk-packet contents.
interface MockSnapshot {
  bulk: BulkParams;
  savedMasterVolumeDb: number;
}

export class MockTransport implements DspTransport {
  #open = false;
  #listeners = new Map<TransportEvent, Set<() => void>>();
  #notifyQueue: Uint8Array[] = [];
  #notifySeq = 0;
  #serial: string;
  #platform: PlatformType;
  #wireVersion: number;
  #payloadLength: number | undefined;
  #fwMajor: number;
  #fwMinorPatch: number;
  #masterVolumeMode: MasterVolumeMode = MasterVolumeMode.Independent;
  #savedMasterVolumeDb = 0;
  #mockState: BulkParams;

  // Preset directory + 10-slot snapshots. Directory metadata is its own wire
  // surface, not part of the bulk packet.
  #presetOccupiedMask = 0;
  #presetStartupMode = 0;       // PresetStartupMode.Specified (firmware default)
  #presetDefaultSlot = 0;
  #presetLastActiveSlot = 0;    // always-active default
  #outputConfigMode: OutputConfigMode = OutputConfigMode.WithPreset;  // firmware default; factory reset resets to it
  #presetActiveSlot = 0;
  // Per-slot names live in the directory sector, not the slot payload, so they
  // survive LoadPreset and are deliberately NOT in MockSnapshot.
  #presetNames: string[] = Array.from({ length: 10 }, () => '');
  // null = empty slot.
  #presetSlots: (MockSnapshot | null)[] = Array.from({ length: 10 }, () => null);

  // Latched clip bitmask, seeded with a demo pattern (bit 1 In1R, bit 4 Out2L)
  // so the CLEAR button and clip indicators have something visible to drive.
  // Stays asserted across polls until ClearClips (0x83), mirroring firmware.
  #clipFlags = 0b0001_0010;

  constructor(opts: MockOptions) {
    this.#serial = opts.serial ?? `MOCK-${opts.platform.toUpperCase()}-0001`;
    this.#platform = opts.platform === 'rp2040' ? PlatformType.RP2040 : PlatformType.RP2350;
    this.#wireVersion = opts.wireVersion ?? 10;
    this.#payloadLength = opts.payloadLength;
    const fw = opts.fwVersion ?? { major: 1, minor: 1, patch: 4 };
    this.#fwMajor = fw.major;
    this.#fwMinorPatch = ((fw.minor & 0xF) << 4) | (fw.patch & 0xF);
    this.#mockState = defaultMockBulkState(this.#platform, this.#wireVersion);
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
    if (this.#isV16) {
      // Firmware V16 defaults: RX data pins on the collision-free GPIO 1..4
      // block, stereo, 48 kHz.
      this.#mockState.inputConfig.i2sRxPins = [1, 2, 3, 4];
      this.#mockState.inputConfig.i2sInputChannels = 2;
      this.#mockState.inputConfig.i2sInputRateEnc = 1;
    }
  }

  get #isV16(): boolean { return this.#wireVersion >= 16; }

  #numChannels(): number {
    return this.#mockState.numCh;
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

  // Enqueue a raw notify packet for the next notifyIn().
  pushNotify(bytes: Uint8Array): void {
    this.#notifyQueue.push(bytes);
  }

  // Mirrors firmware: a load emits presetLoaded(slot) then bulkInvalidated(Preset).
  #pushPresetLoadEvents(slot: number): void {
    this.#notifySeq = (this.#notifySeq + 1) & 0xff;
    this.pushNotify(new Uint8Array([2, 0x04, 0, this.#notifySeq, slot, 0, 0, 0]));
    this.#notifySeq = (this.#notifySeq + 1) & 0xff;
    this.pushNotify(new Uint8Array([2, 0x03, 0, this.#notifySeq, 3, 0, 0, 0]));
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
      case WireCmd.EnterBootloader.code: {
        // Firmware acks one byte, then reboots to UF2 ~100 ms later; mirror
        // that with a deferred close so the normal disconnect flow runs.
        setTimeout(() => { void this.close(); }, 100);
        return new Uint8Array([1]);
      }
      case WireCmd.GetMasterVolume.code:
        return Codec.encode(Codec.f32, this.#mockState.masterVolumeDb);
      case WireCmd.GetPreamp.code:
        return Codec.encode(Codec.f32, this.#mockState.preampDb);
      case WireCmd.GetInputPreamp.code: {
        const idx = value & 0xFF;
        return Codec.encode(Codec.f32, this.#mockState.inputPreampsDb[idx] ?? 0);
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
        this.#savedMasterVolumeDb = this.#mockState.masterVolumeDb;
        return new Uint8Array([0]); // PresetResult.Ok
      // Acknowledge with FlashResult.Ok; preset round-trips go through
      // PresetSave/Load directly rather than flash side effects.
      case WireCmd.SaveParams.code:
      case WireCmd.FactoryReset.code:
        return new Uint8Array([0]); // FlashResult.Ok
      case WireCmd.SaveOutputConfig.code:
        return new Uint8Array([0]); // PresetResult.Ok
      case WireCmd.GetEqParam.code: {
        // Bit-packed wValue. V10: (channel << 8) | (band << 4) | param.
        // V16: band widens to 5 bits, (channel << 8) | (band << 3) | param.
        const channel = (value >> 8) & 0xFF;
        const band  = this.#isV16 ? (value >> 3) & 0x1F : (value >> 4) & 0xF;
        const param = this.#isV16 ? value & 0x7 : value & 0xF;
        const f = this.#bandAt(channel, band);
        if (!f) return new Uint8Array(length);
        switch (param) {
          case 0: return Codec.encode(Codec.u32, f.type);       // Type widens to u32 on the wire
          case 1: return Codec.encode(Codec.f32, f.frequency);
          case 2: return Codec.encode(Codec.f32, f.q);
          case 3: return Codec.encode(Codec.f32, f.gain);
          case 4: return Codec.encode(Codec.u32, f.bypass ? 1 : 0);
          default: return new Uint8Array(length);
        }
      }
      case WireCmd.GetBandBypass.code: {
        const ch = (value >> 8) & 0xFF;
        const band = value & 0xFF;
        return Codec.encode(Codec.bool8, this.#bandAt(ch, band)?.bypass ?? false);
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
      case WireCmd.SetSpdifRxPin.code:
        this.#mockState.inputConfig.spdifRxPin = value & 0xFF;
        return new Uint8Array([0x00]); // PinConfigResult: ok
      case WireCmd.GetInputRate.code: {
        // {current pipeline Hz, selected I2S input Hz}
        const out = new Uint8Array(8);
        const dv = new DataView(out.buffer);
        dv.setUint32(0, 48_000, true);
        dv.setUint32(4, this.#i2sRateHz(), true);
        return out;
      }
      case WireCmd.SetI2sRxPin.code: {
        const pair = (value >> 8) & 0xFF;
        const pin = value & 0xFF;
        if (pair >= 4) return new Uint8Array([0x03]);                    // InvalidOutput: no such pair
        if (!this.#isValidGpio(pin)) return new Uint8Array([0x01]);      // InvalidPin
        if (this.#pinInUse(pin, 0xFF)) return new Uint8Array([0x02]);    // PinInUse
        this.#mockState.inputConfig.i2sRxPins[pair] = pin;
        return new Uint8Array([0x00]);
      }
      case WireCmd.GetI2sRxPin.code: {
        const pair = value & 0xFF;
        return Codec.encode(Codec.u8, this.#mockState.inputConfig.i2sRxPins[pair] ?? 0);
      }
      case WireCmd.SetI2sInputChannels.code: {
        const count = value & 0xFF;
        if (count !== 2 && count !== 4 && count !== 6 && count !== 8) return new Uint8Array([0x01]);
        const maxPairs = this.#platform === PlatformType.RP2350 ? 4 : 1;
        if (count / 2 > maxPairs) return new Uint8Array([0x03]);
        this.#mockState.inputConfig.i2sInputChannels = count;
        return new Uint8Array([0x00]);
      }
      case WireCmd.GetI2sInputChannels.code:
        return Codec.encode(Codec.u8, this.#mockState.inputConfig.i2sInputChannels || 2);
      case WireCmd.TestDacHwMute.code:
        return new Uint8Array([0x00]); // status: pulse scheduled
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
        out[5] = this.#outputConfigMode;
        // Same directory-sector byte as GetMasterVolumeMode; reuse the live
        // field so both read paths stay in sync.
        out[6] = this.#masterVolumeMode;
        return out.slice(0, Math.min(length, out.byteLength));
      }
      case WireCmd.PresetGetStartup.code:
        return Codec.encode(WireCmd.PresetGetStartup.codec, {
          mode: this.#presetStartupMode,
          slot: this.#presetDefaultSlot,
        });
      case WireCmd.GetOutputConfigMode.code:
        return Codec.encode(Codec.u8, this.#outputConfigMode);
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
          // Load on an empty slot applies factory defaults and returns Ok
          // (the historic SLOT_EMPTY error is reserved).
          this.#resetLiveToDefaults();
        }
        this.#presetActiveSlot = slot;
        this.#presetLastActiveSlot = slot;
        this.#pushPresetLoadEvents(slot);
        return new Uint8Array([0]); // Ok
      }
      case WireCmd.PresetDelete.code: {
        const slot = value & 0xFF;
        if (slot >= 10) return new Uint8Array([0x01]); // InvalidSlot
        this.#presetSlots[slot] = null;
        this.#presetOccupiedMask &= ~(1 << slot) & 0xFFFF;
        // Slot name lives in the directory sector and persists through delete,
        // mirroring firmware.
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
        else if (this.#mockState.i2s.outputSlotTypes.some((type) => type === OutputSlotType.I2s)) status = 0x04;
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
        this.#mockState.masterVolumeDb = Codec.decode(Codec.f32, data);
        return;
      case WireCmd.SetPreamp.code:
        this.#mockState.preampDb = Codec.decode(Codec.f32, data);
        return;
      case WireCmd.SetInputPreamp.code: {
        const idx = value & 0xFF;
        if (idx < this.#mockState.inputPreampsDb.length) {
          this.#mockState.inputPreampsDb[idx] = Codec.decode(Codec.f32, data);
        }
        return;
      }
      case WireCmd.SetEqParam.code: {
        const p = Codec.decode(Wire.SetFilterPacket, data);
        const slot = this.#bandSlot(p.channel, p.band);
        if (slot) {
          slot.row[slot.idx] = {
            type: p.type as FilterParams['type'],
            bypass: slot.row[slot.idx].bypass,
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
        const slot = this.#bandSlot(ch, band);
        if (slot) slot.row[slot.idx] = { ...slot.row[slot.idx], bypass: Codec.decode(Codec.bool8, data) };
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
      case WireCmd.SetInputRate.code: {
        const hz = Codec.decode(Codec.u32, data);
        if (hz === 44100 || hz === 48000 || hz === 96000) {
          this.#mockState.inputConfig.i2sInputRateEnc = hz === 44100 ? 0 : hz === 96000 ? 2 : 1;
        }
        return;
      }
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
        this.#mockState.bypass = Codec.decode(Codec.bool8, data);
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
        if (ch < this.#numChannels()) {
          this.#mockState.channelNames[ch] = Codec.decode(WireCmd.SetChannelName.codec, data);
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
      case WireCmd.SetOutputConfigMode.code:
        this.#outputConfigMode = Codec.decode(Codec.u8, data) as OutputConfigMode;
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
      savedMasterVolumeDb: this.#savedMasterVolumeDb,
    };
  }

  // Build the bulk packet at the configured wire version from #mockState. A
  // sub-V6 reject-path mock builds a V6 body but reports the true (sub-V6)
  // version in the header so the connect-reject path is exercised.
  #synthBulkPacket(): Uint8Array {
    const buildVer = Math.min(Math.max(this.#wireVersion, 6), Wire.MAX_WIRE_VERSION);
    const out = buildBulkParams(this.#mockState, buildVer);
    const dv = new DataView(out.buffer);
    dv.setUint8(0, this.#wireVersion);        // report true version (may be < 6)
    dv.setUint16(6, this.#payloadLength ?? out.byteLength, true);  // payloadLength (overridable)
    return out;
  }

  #applyBulkState(bulk: BulkParams): void {
    this.#mockState = bulk;
  }

  // Reset live state to factory defaults (empty-slot PresetLoad).
  #resetLiveToDefaults(): void {
    this.#applyBulkState(defaultMockBulkState(this.#platform, this.#wireVersion));
    this.#savedMasterVolumeDb = 0;
  }

  #restoreSnapshot(s: MockSnapshot): void {
    const liveMv = this.#mockState.masterVolumeDb;       // live value before restore
    this.#mockState = JSON.parse(JSON.stringify(s.bulk)) as BulkParams;
    // Master volume value rides the preset payload only in Mode 1 (with-preset).
    // In Mode 0 (independent) LoadPreset leaves it alone (directory-owned). The
    // mock checks the live mode, matching firmware; mode itself is global and
    // not part of the payload.
    if (this.#masterVolumeMode !== MasterVolumeMode.WithPreset) {
      this.#mockState.masterVolumeDb = liveMv;            // Independent: directory-owned, keep live
    }
    this.#savedMasterVolumeDb = s.savedMasterVolumeDb;
  }

  // Writable reference to the OutputState slot for a wValue-encoded output index.
  #output(wValue: number): OutputState {
    return this.#mockState.outputs![wValue & 0xFF];
  }

  // Resolves a wire (channel, band) address to its storage slot: PEQ bands in
  // filters[], crossover bands (V16, wire indices 20..23) in crossover[].
  #bandSlot(ch: number, band: number): { row: WireFilter[]; idx: number } | null {
    if (ch >= this.#numChannels()) return null;
    if (band < Wire.Const.BANDS_MAX) {
      const row = this.#mockState.filters?.[ch];
      return row?.[band] ? { row, idx: band } : null;
    }
    if (this.#isV16 && band >= XOVER_BAND_BASE && band < XOVER_BAND_BASE + MAX_XOVER_BANDS) {
      const row = this.#mockState.crossover?.[ch];
      const idx = band - XOVER_BAND_BASE;
      return row?.[idx] ? { row, idx } : null;
    }
    return null;
  }

  #bandAt(ch: number, band: number): WireFilter | null {
    const slot = this.#bandSlot(ch, band);
    return slot ? slot.row[slot.idx] : null;
  }

  #numSpdif(): number {
    return this.#platform === PlatformType.RP2350 ? 4 : 2;
  }

  #isValidGpio(pin: number): boolean {
    // Debug UART pins: GPIO 12 through V10, GPIO 16/17 from V16 (fw moved it).
    if (this.#isV16 ? (pin === 16 || pin === 17) : pin === 12) return false;
    if (pin >= 23 && pin <= 25) return false;
    return pin >= 0 && pin <= (this.#platform === PlatformType.RP2350 ? 29 : 28);
  }

  #pinInUse(pin: number, excludeIdx: number): boolean {
    const pins = this.#mockState.pins;
    for (let i = 0; i < this.#mockState.numPinOutputs; i++) {
      if (i === excludeIdx) continue;
      if (pins[i] === pin) return true;
    }
    const i2s = this.#mockState.i2s;
    if (i2s.outputSlotTypes.some((type) => type === OutputSlotType.I2s) && (pin === i2s.bckPin || pin === i2s.bckPin + 1)) return true;
    if (i2s.mckEnabled && pin === i2s.mckPin) return true;
    if (this.#isV16) {
      // Active I2S RX pairs reserve their data pins (fw is_pin_in_use).
      const activePairs = (this.#mockState.inputConfig.i2sInputChannels || 2) / 2;
      const rxPins = this.#mockState.inputConfig.i2sRxPins;
      for (let p = 0; p < activePairs; p++) if (rxPins[p] === pin) return true;
    }
    return false;
  }

  // Live active input channel count: USB-source count is the alt-driven value
  // (always 2 in the mock); I2S follows the configured channel count.
  #activeInputChannels(): number {
    const cfg = this.#mockState.inputConfig;
    return cfg.source === 2 ? (cfg.i2sInputChannels || 2) : 2;
  }

  #i2sRateHz(): number {
    const enc = this.#mockState.inputConfig.i2sInputRateEnc;
    return enc === 0 ? 44100 : enc === 2 ? 96000 : 48000;
  }

  // Dispatch GetStatus by wValue, returning a fresh buffer sized to the request.
  #synthStatus(wValue: number, length: number): Uint8Array {
    switch (wValue) {
      case SystemStatusValue.CombinedPeaks: {
        // Caller sizes the request: numCh = (length - tail) / 2, where the
        // tail is 4 B on V10 and 7 B on V16 (u32 clip + input-count byte).
        const tail = this.#isV16 ? 7 : 4;
        const numCh = Math.max(0, (length - tail) >> 1);
        const peaks = Array.from({ length: numCh }, (_, i) => (i + 1) / numCh);
        return synthesizeSystemStatus({
          numCh, peaks, cpu0: 25, cpu1: 12, clipFlags: this.#clipFlags,
          ...(this.#isV16 ? { activeInputChannels: this.#activeInputChannels() } : {}),
        });
      }
      case SystemStatusValue.ActiveInputChannels:
        return synthesizeU32(this.#isV16 ? this.#activeInputChannels() : 0);
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
