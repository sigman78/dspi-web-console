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
  PlatformType, OutputSlotType, AudioInputSource,
  CrossfeedPreset, LevellerSpeed, MasterVolumeMode, OutputConfigMode,
  XOVER_BAND_BASE, MAX_XOVER_BANDS,
  DEFAULT_UART_CONTROL_CONFIG, DEFAULT_I2C_CONTROL_CONFIG,
  isValidUartPinPair, isValidI2cPinPair, isValidUartBaud, isValidI2cAddress,
  CsType, CS_GPIO_UNUSED, CS_MAX_BINDINGS, validateCsBinding,
  defaultInputName,
  type FilterParams,
  type CrossPoint, type OutputState,
  type UartControlConfig, type I2cControlConfig,
  type CsCaps, type CsNounCaps, type CsKind,
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
  // Imaginary I2S multichannel input for the demo (V16+ only): boot with the
  // source set to I2S and this many active input channels (2/4/6/8) instead of
  // the default USB stereo, so the multichannel UI has more than a pair to show.
  i2sInputChannels?: number;
  // Imaginary multi-SPDIF demo (fw 1.1.5+, RP2350 only): boot with this many
  // selectable S/PDIF inputs enabled (1 = just the always-on input 1; 2/3
  // additionally enable input 2/3 on their default GPIOs) so the source
  // picker has more than one SPDIF input to show.
  spdifInputsEnabled?: number;
}

const defaultCrosspoint = (): CrossPoint => ({ enabled: false, invert: false, gainDb: 0 });

// Control Surfaces caps tables, firmware capability format version 1
// (control_surfaces.c s_caps / s_noun_desc).
const MOCK_CS_CAPS: CsCaps = {
  capsVersion: 1,
  maxBindings: CS_MAX_BINDINGS,
  types: [
    { actions: 0x0000, pinCount: 0, pinClass: 0 },  // NONE
    { actions: 0x00BC, pinCount: 1, pinClass: 0 },  // BUTTON: INC/DEC/TOGGLE/SET/TRIGGER
    { actions: 0x0040, pinCount: 1, pinClass: 0 },  // SWITCH: FOLLOW
    { actions: 0x0001, pinCount: 1, pinClass: 1 },  // POT: ADJUST, ADC pins
    { actions: 0x0002, pinCount: 2, pinClass: 0 },  // ENCODER: STEP
    { actions: 0x0100, pinCount: 1, pinClass: 0 },  // LED: IND_EQUALS
  ],
};

const MOCK_CS_NOUNS: CsNounCaps[] = [
  { kind: 0 as CsKind, enumCount: 0,  actions: 0x002F, minQ8: -15360, maxQ8: 0 },  // USER_VOLUME −60..0 dB
  { kind: 0 as CsKind, enumCount: 0,  actions: 0x002F, minQ8: -32512, maxQ8: 0 },  // MASTER_VOLUME −127..0 dB
  { kind: 1 as CsKind, enumCount: 0,  actions: 0x0170, minQ8: 0, maxQ8: 0 },       // USER_MUTE
  { kind: 1 as CsKind, enumCount: 0,  actions: 0x0170, minQ8: 0, maxQ8: 0 },       // LOUDNESS
  { kind: 1 as CsKind, enumCount: 0,  actions: 0x0170, minQ8: 0, maxQ8: 0 },       // CROSSFEED
  { kind: 1 as CsKind, enumCount: 0,  actions: 0x0170, minQ8: 0, maxQ8: 0 },       // LEVELLER
  { kind: 2 as CsKind, enumCount: 10, actions: 0x012E, minQ8: 0, maxQ8: 0 },       // PRESET
  { kind: 2 as CsKind, enumCount: 3,  actions: 0x012E, minQ8: 0, maxQ8: 0 },       // INPUT_SOURCE
  { kind: 1 as CsKind, enumCount: 0,  actions: 0x0180, minQ8: 0, maxQ8: 0 },       // CLIP: TRIGGER/IND_EQUALS
];

// Wire-shaped stored binding (gpio1 stays raw 0xFF when unused).
interface MockCsBinding {
  type: number; noun: number; action: number; flags: number;
  gpio0: number; gpio1: number;
  value: number; step: number; rangeMin: number; rangeMax: number;
}

const emptyCsBinding = (): MockCsBinding => ({
  type: 0, noun: 0, action: 0, flags: 0, gpio0: 0, gpio1: 0,
  value: 0, step: 0, rangeMin: 0, rangeMax: 0,
});

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

// Seeds #mockState at construction and resets live state on empty-slot
// LoadPreset (firmware applies factory defaults rather than returning SlotEmpty).
// V16 grows the RP2350 to the unified 17-channel space (8 inputs); RP2040
// stays 7-wide on both generations.
function defaultMockBulkState(platform: PlatformType, wireVersion: number): BulkParams {
  const v16 = wireVersion >= 16;
  const numIn  = v16 && platform === PlatformType.RP2350 ? 8 : 2;
  const numOut = platform === PlatformType.RP2350 ? 9 : 5;
  const numCh  = numIn + numOut;
  const state = defaultBulkParams({
    platformId: platform, numCh, numOut, numIn,
    formatVersion: Math.max(wireVersion, 6),
  });
  // A fresh packet has every output disabled; the mock stands in for a
  // configured device, so enable the stereo outputs (PDM, the last slot, stays
  // off) -- the ?mock= demo then shows live output channels in the rail.
  for (let i = 0; i < numOut - 1; i++) state.outputs![i].enabled = true;
  // Mirrors firmware boot init: input channel names start populated with the
  // default source's names, not empty. Input slots are wire-first (slot
  // index === wire index) on every profile this mock builds.
  for (let slot = 0; slot < numIn; slot++) {
    state.channelNames[slot] = defaultInputName(state.inputConfig.source as AudioInputSource, slot);
  }
  return state;
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

  // Chunked bulk-params (0xA2/0xA3) session state, V16-only. Mirrors the
  // firmware contract: chunks must be sequential from offset 0, and any
  // non-chunk vendor request tears down whichever session is open.
  #getChunkSession: { buf: Uint8Array; offset: number } | null = null;
  #setChunkSession: { chunks: Uint8Array[]; length: number; target: number } | null = null;

  // External control interfaces (V16+, 0xF5-0xF9). Shipped-disabled defaults;
  // last_status/live start at "no attempt yet" / down.
  #uartCtrl: UartControlConfig = { ...DEFAULT_UART_CONTROL_CONFIG };
  #i2cCtrl: I2cControlConfig = { ...DEFAULT_I2C_CONTROL_CONFIG };
  #uartLastStatus = 0x00;
  #i2cLastStatus = 0x00;
  #uartLive = false;
  #i2cLive = false;

  // Control surfaces (V16+, 0x84-0x87). The mock applies a SET immediately,
  // but reports PENDING on the first status read after an accepted SET so
  // the device-side poll loop's deferred-apply handling gets exercised.
  #csBindings: MockCsBinding[] = Array.from({ length: CS_MAX_BINDINGS }, emptyCsBinding);
  #csSlotStatus: number[] = Array.from({ length: CS_MAX_BINDINGS }, () => 0);
  #csLastStatus = 0x00;
  #csLastSlot = 0;
  #csPendingPolls = 0;

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

      // Imaginary I2S multichannel input for the demo: switch the source to I2S
      // with the requested channel count (clamped even, 2..8) and re-derive the
      // source-aware input names, so the multichannel UI has more than a stereo
      // pair to display.
      if (opts.i2sInputChannels && opts.i2sInputChannels > 2) {
        const n = Math.min(8, Math.max(2, opts.i2sInputChannels - (opts.i2sInputChannels % 2)));
        this.#mockState.inputConfig.source = AudioInputSource.I2s;
        this.#mockState.inputConfig.i2sInputChannels = n;
        for (let slot = 0; slot < n; slot++) {
          this.#mockState.channelNames[slot] = defaultInputName(AudioInputSource.I2s, slot);
        }
      }

      // Multi-SPDIF (fw 1.1.5+) is RP2350-only, mirroring capabilities'
      // multiSpdifInputs gate. Seed inputs 2/3 on collision-free GPIOs,
      // "present but disabled" by default so the picker has real pins to
      // offer; RP2040 stays single-input (fields stay at the all-zero
      // "absent" default from defaultBulkParams).
      if (this.#platform === PlatformType.RP2350) {
        this.#mockState.inputConfig.spdifRxPinExt = [20, 21];
        this.#mockState.inputConfig.spdifRxEnabledExtP1 = 1;   // mask 0: both disabled
        if (opts.spdifInputsEnabled && opts.spdifInputsEnabled > 1) {
          const n = Math.min(3, Math.max(1, opts.spdifInputsEnabled | 0));
          let mask = 0;
          for (let i = 2; i <= n; i++) mask |= 1 << (i - 2);
          this.#mockState.inputConfig.spdifRxEnabledExtP1 = mask + 1;
        }
      }
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
    if (request !== WireCmd.GetAllParamsChunk.code) this.#getChunkSession = null;
    if (request !== WireCmd.SetAllParamsChunk.code) this.#setChunkSession = null;
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
      case WireCmd.GetAllParamsChunk.code: {
        if (!this.#isV16) return new Uint8Array(length);
        if (value === 0) {
          this.#getChunkSession = { buf: this.#synthBulkPacket(), offset: 0 };
        }
        const session = this.#getChunkSession;
        if (!session || value !== session.offset) {
          this.#getChunkSession = null;
          throw new Error(`MockTransport: GetAllParamsChunk out-of-order offset ${value}`);
        }
        const end = Math.min(session.offset + length, session.buf.length);
        const chunk = session.buf.slice(session.offset, end);
        session.offset = end;
        if (session.offset >= session.buf.length) this.#getChunkSession = null;
        return chunk;
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
      case WireCmd.GetLevellerMasks.code:
        return Codec.encode(Wire.LevellerMasks, {
          detector: this.#mockState.leveller!.detectorMask,
          apply: this.#mockState.leveller!.applyMask,
        });
      case WireCmd.GetInputSource.code:
        return Codec.encode(Codec.u8, this.#mockState.inputConfig.source);
      case WireCmd.GetSpdifRxStatus.code:
        return Codec.encode(Wire.SpdifRxStatus, {
          state: 2, inputSource: this.#mockState.inputConfig.source,
          lockCount: 1, lossCount: 0, sampleRate: 48000, parityErrors: 0, fifoFillPct: 50,
        });
      case WireCmd.GetSpdifRxChStatus.code:
        return new Uint8Array(Wire.SPDIF_RX_CH_STATUS_LEN);
      case WireCmd.GetSpdifRxPin.code: {
        const index = value & 0xFF;
        const gpio = index === 0
          ? this.#mockState.inputConfig.spdifRxPin
          : (this.#mockState.inputConfig.spdifRxPinExt[index - 1] ?? 0);
        return Codec.encode(Codec.u8, gpio);
      }
      case WireCmd.SetSpdifRxPin.code: {
        const index = (value >> 8) & 0xFF;
        const gpio = value & 0xFF;
        if (index >= this.#spdifInputCount()) return new Uint8Array([0x03]);   // InvalidOutput: no such input
        if (!this.#isValidGpio(gpio)) return new Uint8Array([0x01]);           // InvalidPin
        if (this.#pinInUse(gpio, 0xFF)) return new Uint8Array([0x02]);         // PinInUse
        if (index === 0) this.#mockState.inputConfig.spdifRxPin = gpio;
        else this.#mockState.inputConfig.spdifRxPinExt[index - 1] = gpio;
        return new Uint8Array([0x00]);
      }
      // Enable/disable a selectable S/PDIF input (index 1..2; index 0 -- always
      // on -- accepts enable as a no-op and refuses disable). Updates the
      // mask+1-encoded spdifRxEnabledExtP1 field so it rides the bulk packet.
      case WireCmd.SetSpdifInputEnable.code: {
        const index = (value >> 8) & 0xFF;
        const enable = (value & 0xFF) !== 0;
        if (index === 0) return new Uint8Array([enable ? 0x00 : 0x03]);
        if (index >= this.#spdifInputCount()) return new Uint8Array([0x03]);  // InvalidOutput
        const cfg = this.#mockState.inputConfig;
        const bit = 1 << (index - 1);
        let mask = cfg.spdifRxEnabledExtP1 === 0 ? 0 : cfg.spdifRxEnabledExtP1 - 1;
        if (enable) {
          const pin = cfg.spdifRxPinExt[index - 1];
          if (!this.#isValidGpio(pin)) return new Uint8Array([0x01]);
          if (this.#pinInUse(pin, 0xFF)) return new Uint8Array([0x02]);       // PinInUse
          mask |= bit;
        } else {
          mask &= ~bit;
        }
        cfg.spdifRxEnabledExtP1 = mask + 1;
        return new Uint8Array([0x00]);
      }
      case WireCmd.GetSpdifInputConfig.code: {
        const cfg = this.#mockState.inputConfig;
        const mask = cfg.spdifRxEnabledExtP1 === 0 ? 0 : cfg.spdifRxEnabledExtP1 - 1;
        return Codec.encode(Wire.SpdifInputConfig, {
          count: this.#spdifInputCount(),
          enableMask: 1 | (mask << 1),
          pins: [cfg.spdifRxPin, cfg.spdifRxPinExt[0] ?? 0, cfg.spdifRxPinExt[1] ?? 0],
        });
      }
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
        const changed = this.#mockState.inputConfig.i2sInputChannels !== count;
        this.#mockState.inputConfig.i2sInputChannels = count;
        // Firmware pushes INPUT_FORMAT only when the live count changed
        // (I2S is the active source).
        if (changed && this.#mockState.inputConfig.source === 2) {
          this.#notifySeq = (this.#notifySeq + 1) & 0xff;
          this.pushNotify(new Uint8Array([2, 0x05, 0, this.#notifySeq, count, 0, 0, 0]));
        }
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
      case WireCmd.GetUartConfig.code: {
        if (!this.#isV16) return new Uint8Array(length);
        const c = this.#uartCtrl;
        return Codec.encode(Wire.UartCtrlConfig, {
          enabled: c.enabled, txPin: c.txPin, rxPin: c.rxPin, notifyEnable: c.notifyEnabled, baud: c.baud,
        });
      }
      case WireCmd.GetI2cConfig.code: {
        if (!this.#isV16) return new Uint8Array(length);
        const c = this.#i2cCtrl;
        return Codec.encode(Wire.I2cCtrlConfig, { enabled: c.enabled, sdaPin: c.sdaPin, sclPin: c.sclPin, address: c.address });
      }
      case WireCmd.GetCtrlIfaceStatus.code: {
        if (!this.#isV16) return new Uint8Array(length);
        return Codec.encode(Wire.CtrlIfaceStatus, {
          uartLastStatus: this.#uartLastStatus, uartLive: this.#uartLive,
          i2cLastStatus: this.#i2cLastStatus, i2cLive: this.#i2cLive,
          protoVersion: 1,
        });
      }
      case WireCmd.GetCsBinding.code: {
        if (!this.#isV16) return new Uint8Array(length);
        if (value >= CS_MAX_BINDINGS) throw new Error('MockTransport: GetCsBinding slot out of range (STALL)');
        const b = this.#csBindings[value];
        return Codec.encode(Wire.CsBinding, b);
      }
      case WireCmd.GetCsCaps.code: {
        if (!this.#isV16) return new Uint8Array(length);
        if (value === 0xFFFF) {
          return Codec.encode(Wire.CsCapsHeader, {
            capsVersion: MOCK_CS_CAPS.capsVersion,
            maxBindings: MOCK_CS_CAPS.maxBindings,
            typeCount: MOCK_CS_CAPS.types.length,
            nounCount: MOCK_CS_NOUNS.length,
            types: MOCK_CS_CAPS.types.map((t) => ({ actions: t.actions, pinCount: t.pinCount, pinClass: t.pinClass })),
          });
        }
        if (value < MOCK_CS_NOUNS.length) {
          const n = MOCK_CS_NOUNS[value];
          return Codec.encode(Wire.CsNounDesc, {
            kind: n.kind, enumCount: n.enumCount, actions: n.actions, minQ8: n.minQ8, maxQ8: n.maxQ8,
          });
        }
        throw new Error('MockTransport: GetCsCaps noun index out of range (STALL)');
      }
      case WireCmd.GetCsStatus.code: {
        if (!this.#isV16) return new Uint8Array(length);
        let lastStatus = this.#csLastStatus;
        if (this.#csPendingPolls > 0) {
          this.#csPendingPolls -= 1;
          lastStatus = 0x16;                          // CS_STATUS_PENDING
        }
        let activeMask = 0;
        this.#csBindings.forEach((b, i) => {
          if (b.type !== CsType.None && this.#csSlotStatus[i] === 0) activeMask |= 1 << i;
        });
        return Codec.encode(Wire.CsStatusPacket, {
          lastStatus, lastSlot: this.#csLastSlot,
          maxBindings: CS_MAX_BINDINGS, activeMask,
          slotStatus: this.#csSlotStatus.slice(),
        });
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
    if (request !== WireCmd.GetAllParamsChunk.code) this.#getChunkSession = null;
    if (request !== WireCmd.SetAllParamsChunk.code) this.#setChunkSession = null;
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
      case WireCmd.SetInputSource.code: {
        const newSource = Codec.decode(Codec.u8, data);
        const oldSource = this.#mockState.inputConfig.source;
        this.#mockState.inputConfig.source = newSource;
        if (newSource !== oldSource) this.#regenerateInputDefaultNames(oldSource, newSource);
        return;
      }
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
      case WireCmd.SetLevellerMasks.code: {
        const m = Codec.decode(Wire.LevellerMasks, data);
        this.#mockState.leveller!.detectorMask = m.detector;
        this.#mockState.leveller!.applyMask = m.apply;
        return;
      }

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

      case WireCmd.SetUartConfig.code: {
        if (!this.#isV16) return;
        const cfg = Codec.decode(Wire.UartCtrlConfig, data);
        this.#uartLastStatus = this.#validateUartConfig(cfg);
        if (this.#uartLastStatus === 0x00) {
          this.#uartCtrl = { enabled: cfg.enabled, txPin: cfg.txPin, rxPin: cfg.rxPin, notifyEnabled: cfg.notifyEnable, baud: cfg.baud };
          this.#uartLive = cfg.enabled;
        }
        return;
      }
      case WireCmd.SetI2cConfig.code: {
        if (!this.#isV16) return;
        const cfg = Codec.decode(Wire.I2cCtrlConfig, data);
        this.#i2cLastStatus = this.#validateI2cConfig(cfg);
        if (this.#i2cLastStatus === 0x00) {
          this.#i2cCtrl = { enabled: cfg.enabled, sdaPin: cfg.sdaPin, sclPin: cfg.sclPin, address: cfg.address };
          this.#i2cLive = cfg.enabled;
        }
        return;
      }

      case WireCmd.SetCsBinding.code: {
        if (!this.#isV16) return;
        if (value >= CS_MAX_BINDINGS) {
          // Bad slot is rejected by the handler itself -- immediate, no
          // PENDING window.
          this.#csLastStatus = 0x10;                  // CS_STATUS_INVALID_SLOT
          this.#csLastSlot = value & 0xFF;
          return;
        }
        const w = Codec.decode(Wire.CsBinding, data);
        this.#csLastSlot = value;
        this.#csPendingPolls = 1;
        this.#csLastStatus = this.#applyCsBinding(value, w);
        return;
      }

      case WireCmd.SetAllParams.code: {
        this.#applySetAllParams(data);
        return;
      }

      case WireCmd.SetAllParamsChunk.code: {
        if (!this.#isV16) return;
        if (value === 0) {
          this.#setChunkSession = { chunks: [], length: 0, target: this.#synthBulkPacket().length };
        }
        const session = this.#setChunkSession;
        if (!session || value !== session.length) {
          this.#setChunkSession = null;
          throw new Error(`MockTransport: SetAllParamsChunk out-of-order offset ${value}`);
        }
        session.chunks.push(new Uint8Array(data));
        session.length += data.length;
        if (session.length >= session.target) {
          this.#applySetAllParams(concatChunks(session.chunks));
          this.#setChunkSession = null;
        }
        return;
      }

      default:
        return;
    }
  }

  #applySetAllParams(data: Uint8Array): void {
    this.#applyBulkState(parseBulkParams(data));
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

  // Mirrors firmware's default-name regen on a source switch: only channel
  // names still equal to the OLD default get overwritten, so a user-set
  // custom name survives. I2S channel-count changes don't regen names --
  // the firmware scheme keys only on (channel, source).
  #regenerateInputDefaultNames(oldSource: number, newSource: number): void {
    const numIn = this.#mockState.numIn;
    for (let slot = 0; slot < numIn; slot++) {
      const oldDefault = defaultInputName(oldSource as AudioInputSource, slot);
      const newDefault = defaultInputName(newSource as AudioInputSource, slot);
      if (oldDefault === newDefault) continue;
      if ((this.#mockState.channelNames[slot] ?? '') !== oldDefault) continue;
      this.#mockState.channelNames[slot] = newDefault;
    }
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

  // Selectable S/PDIF RX inputs sharing the one receiver (fw 1.1.5+ RP2350
  // only). Mirrors capabilities.ts's multiSpdifInputs gate.
  #spdifInputCount(): number {
    return this.#isV16 && this.#platform === PlatformType.RP2350 ? 3 : 1;
  }

  #isValidGpio(pin: number): boolean {
    // Debug UART pin: GPIO 12 through V10 only. Fw 1.1.5 (V16) removed the
    // dedicated debug UART, freeing 16/17 for general use.
    if (!this.#isV16 && pin === 12) return false;
    if (pin >= 23 && pin <= 25) return false;
    return pin >= 0 && pin <= (this.#platform === PlatformType.RP2350 ? 29 : 28);
  }

  // Peripheral pins only (outputs/I2S/MCK/I2S-RX) -- excludes the ctrl
  // interfaces themselves, so a ctrl-iface SET can validate against every
  // OTHER peripheral without self-conflicting on its own current pins.
  #peripheralPinInUse(pin: number, excludeIdx: number): boolean {
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
    // S/PDIF RX: input 1 is always claimed; inputs 2/3 only while enabled
    // (mirrors the I2S RX loop above).
    const spdif = this.#mockState.inputConfig;
    if (pin === spdif.spdifRxPin) return true;
    const spdifExtMask = spdif.spdifRxEnabledExtP1 === 0 ? 0 : spdif.spdifRxEnabledExtP1 - 1;
    for (let i = 0; i < 2; i++) if ((spdifExtMask & (1 << i)) !== 0 && spdif.spdifRxPinExt[i] === pin) return true;
    return false;
  }

  #pinInUse(pin: number, excludeIdx: number): boolean {
    if (this.#peripheralPinInUse(pin, excludeIdx)) return true;
    if (this.#uartCtrl.enabled && (pin === this.#uartCtrl.txPin || pin === this.#uartCtrl.rxPin)) return true;
    if (this.#i2cCtrl.enabled && (pin === this.#i2cCtrl.sdaPin || pin === this.#i2cCtrl.sclPin)) return true;
    if (this.#csOwnsPin(pin)) return true;
    return false;
  }

  // Pin claimed by a live control-surface binding (fw
  // control_surfaces_owns_pin, wired into pin_used_by_fixed_peripheral).
  #csOwnsPin(pin: number, excludeSlot = -1): boolean {
    return this.#csBindings.some((b, i) =>
      i !== excludeSlot && b.type !== CsType.None && this.#csSlotStatus[i] === 0 &&
      (b.gpio0 === pin || (b.gpio1 !== CS_GPIO_UNUSED && b.gpio1 === pin)));
  }

  // Validate + apply one binding, mirroring control_surfaces_apply_binding:
  // table validation (shared with the console via validateCsBinding), then
  // GPIO range, then conflicts against every other claim. Applies
  // immediately on success; the PENDING window is simulated by the status
  // read, not here.
  #applyCsBinding(slot: number, w: MockCsBinding): number {
    if (w.type === CsType.None) {
      this.#csBindings[slot] = emptyCsBinding();
      this.#csSlotStatus[slot] = 0;
      return 0x00;
    }
    const tableStatus = validateCsBinding(
      {
        type: w.type as CsType, noun: w.noun as never, action: w.action as never, flags: w.flags,
        gpio0: w.gpio0, gpio1: w.gpio1 === CS_GPIO_UNUSED ? null : w.gpio1,
        value: w.value, step: w.step, rangeMin: w.rangeMin, rangeMax: w.rangeMax,
      },
      MOCK_CS_CAPS, MOCK_CS_NOUNS,
    );
    if (tableStatus !== 0x00) return tableStatus;
    const pins = MOCK_CS_CAPS.types[w.type].pinCount === 2 ? [w.gpio0, w.gpio1] : [w.gpio0];
    for (const pin of pins) {
      if (!this.#isValidGpio(pin)) return 0x01;                                  // InvalidPin
      const conflict =
        this.#peripheralPinInUse(pin, 0xFF)
        || (this.#uartCtrl.enabled && (pin === this.#uartCtrl.txPin || pin === this.#uartCtrl.rxPin))
        || (this.#i2cCtrl.enabled && (pin === this.#i2cCtrl.sdaPin || pin === this.#i2cCtrl.sclPin))
        || this.#csOwnsPin(pin, slot);                                           // own slot re-uses its pins freely
      if (conflict) return 0x02;                                                 // PinInUse
    }
    this.#csBindings[slot] = { ...w };
    this.#csSlotStatus[slot] = 0;
    return 0x00;
  }

  #validateUartConfig(cfg: { txPin: number; rxPin: number; baud: number }): number {
    if (!isValidUartBaud(cfg.baud)) return 0x05;                                  // InvalidParam
    if (!this.#isValidGpio(cfg.txPin) || !this.#isValidGpio(cfg.rxPin)) return 0x01;  // InvalidPin
    if (!isValidUartPinPair(cfg.txPin, cfg.rxPin)) return 0x01;
    if (this.#peripheralPinInUse(cfg.txPin, 0xFF) || this.#peripheralPinInUse(cfg.rxPin, 0xFF)) return 0x02; // PinInUse
    if (this.#csOwnsPin(cfg.txPin) || this.#csOwnsPin(cfg.rxPin)) return 0x02;
    const i2c = this.#i2cCtrl;
    if (i2c.enabled && [cfg.txPin, cfg.rxPin].includes(i2c.sdaPin)) return 0x02;
    if (i2c.enabled && [cfg.txPin, cfg.rxPin].includes(i2c.sclPin)) return 0x02;
    return 0x00;
  }

  #validateI2cConfig(cfg: { sdaPin: number; sclPin: number; address: number }): number {
    if (!isValidI2cAddress(cfg.address)) return 0x05;                             // InvalidParam
    if (!this.#isValidGpio(cfg.sdaPin) || !this.#isValidGpio(cfg.sclPin)) return 0x01; // InvalidPin
    if (!isValidI2cPinPair(cfg.sdaPin, cfg.sclPin)) return 0x01;
    if (this.#peripheralPinInUse(cfg.sdaPin, 0xFF) || this.#peripheralPinInUse(cfg.sclPin, 0xFF)) return 0x02; // PinInUse
    if (this.#csOwnsPin(cfg.sdaPin) || this.#csOwnsPin(cfg.sclPin)) return 0x02;
    const uart = this.#uartCtrl;
    if (uart.enabled && [cfg.sdaPin, cfg.sclPin].includes(uart.txPin)) return 0x02;
    if (uart.enabled && [cfg.sdaPin, cfg.sclPin].includes(uart.rxPin)) return 0x02;
    return 0x00;
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

  // Time-driven fake meter levels so the sidebar VU meters animate in mock/demo
  // mode as if the device were streaming. Each channel rides a slow swell and a
  // faster tremor at a decorrelated phase, with sparse Math.pow-sharpened
  // transients that punch into the amber/red zones. Pure function of the clock
  // (no RNG), so it stays smooth across the 20 Hz poll cadence.
  #animatedPeaks(numCh: number): number[] {
    const t = performance.now() / 1000;
    return Array.from({ length: numCh }, (_, i) => {
      const phase = i * 1.9;
      const slow = 0.5 + 0.5 * Math.sin(t * 0.6 + phase);
      const fast = 0.5 + 0.5 * Math.sin(t * 4.7 + phase * 2.3);
      const spike = Math.pow(0.5 + 0.5 * Math.sin(t * 1.3 + phase * 3.1), 14);
      // Target reading in the meter's own 0..1 domain: a low floor, a slow swell
      // shaped by a faster tremor, plus sparse transients that reach the red.
      const level = Math.min(1, 0.1 + 0.75 * slow * (0.5 + 0.5 * fast) + 0.35 * spike);
      // The wire carries LINEAR amplitude, but the meter reads 20·log10 mapped
      // onto -60..0 dB. Inverting that here (level -> 10^(3·(level-1))) makes the
      // animation sweep the whole meter instead of bunching up near clip, where
      // a linear ramp would sit (0.34 amplitude already reads ~84%).
      return Math.pow(10, 3 * (level - 1));
    });
  }

  // Dispatch GetStatus by wValue, returning a fresh buffer sized to the request.
  #synthStatus(wValue: number, length: number): Uint8Array {
    switch (wValue) {
      case SystemStatusValue.CombinedPeaks: {
        // Caller sizes the request: numCh = (length - tail) / 2, where the
        // tail is 4 B on V10 and 7 B on V16 (u32 clip + input-count byte).
        const tail = this.#isV16 ? 7 : 4;
        const numCh = Math.max(0, (length - tail) >> 1);
        const peaks = this.#animatedPeaks(numCh);
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
