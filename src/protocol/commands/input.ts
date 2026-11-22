import { Codec } from '@/utils';
import type { AudioInputSource, LgSoundSync } from '@/domain';
import * as Wire from '../wireTypes';
import { tighten } from './tighten';
import type { ActionCommand, Command, RawCommand } from './types';

export const InputCmd = {
  // --- Input source and board names (fw 1.1.6 release). ---
  // 0x54-0x57 carried a legacy per-channel gain/mute on older firmware (0x55
  // answers 4 B, 0x57 answers 1 B, and a 0x54/0x56 write stores the bytes as a
  // gain/mute). Never send a SET before the matching 32-byte GET probe
  // succeeded; DspDevice enforces that. SET: 1-32 B, a leading NUL clears.
  // GET: 32 B NUL-terminated, zeros = unnamed. wValue = source ID (board name: 0).
  InputSourceName: { codec: Wire.ChannelName, legacy: { get: 0x55, set: 0x54 } } satisfies Command<string>,
  InputSource: { codec: tighten<AudioInputSource>(Codec.u8), legacy: { get: 0xE1, set: 0xE0 } } satisfies Command<AudioInputSource>,

  // --- S/PDIF input ---
  // Live status reads (no bulk equivalent).
  SpdifRxStatus: { codec: Wire.SpdifRxStatus, legacy: { get: 0xE2 } },
  SpdifRxChStatus: { legacy: { get: 0xE3 } } satisfies RawCommand,
  // S/PDIF RX pin: status byte on GET.
  SpdifRxPin: { codec: Codec.u8, legacy: { get: 0xE5 } } satisfies Command<number>,
  // Multi-SPDIF input config (fw 1.1.5+): GET returns
  // [count, enableMask, pin0..pin3] (enableMask unshifted).
  SpdifInputConfig: { codec: Wire.SpdifInputConfig, legacy: { get: 0xEF } } satisfies Command<{ count: number; enableMask: number; pins: number[] }>,

  // --- LG Sound Sync ---
  LgSoundSyncEnabled: { codec: Codec.bool8, legacy: { get: 0xE7, set: 0xE6 } } satisfies Command<boolean>,
  LgSoundSyncStatus: { codec: tighten<LgSoundSync>(Wire.LgSoundSync), legacy: { get: 0xE8 } } satisfies Command<LgSoundSync>,

  // --- I2S-input surface ---
  // The device is the rate authority while I2S input is active, so the rate
  // is a command, not a detection. Set: u32 Hz payload (44100/48000/96000).
  // Get: 8-byte response {current pipeline Hz, selected I2S Hz}.
  InputRate: { codec: Codec.u32, legacy: { set: 0xED } } satisfies Command<number>,
  InputRateStatus: { legacy: { get: 0xEE } } satisfies RawCommand,
  // I2S RX data pin per stereo pair: GET takes the pair in wValue and returns
  // that pair's GPIO.
  I2sRxPin: { codec: Codec.u8, legacy: { get: 0xF2 } } satisfies Command<number>,
  // Active I2S input channel count (2/4/6/8; RP2350 multichannel).
  I2sInputChannels: { codec: Codec.u8, legacy: { get: 0xF4 } } satisfies Command<number>,

  // --- ADAT input config (RP2350). SETs are action-style, see InputAct. ---
  AdatInputEnable: { codec: Codec.bool8, legacy: { get: 0x69 } } satisfies Command<boolean>,
  AdatInputPin: { codec: Codec.u8, legacy: { get: 0x6B } } satisfies Command<number>,
  AdatInputClockMode: { codec: Codec.u8, legacy: { get: 0x6D } } satisfies Command<number>,
  AdatInputStatus: { codec: Wire.AdatInputStatus, legacy: { get: 0x6E } },
} as const;

export const InputAct = {
  // S/PDIF RX pin: wValue = GPIO.
  SpdifRxPin: { legacy: { code: 0xE4 } } satisfies ActionCommand,
  // Multi-SPDIF input enable (fw 1.1.5+): one physical receiver fanned out
  // over up to 4 selectable GPIOs. Set is action-IN with
  // wValue = (index<<8)|enable (index 1..3), 1-byte PinConfigResult.
  SpdifInputEnable: { legacy: { code: 0xE9 } } satisfies ActionCommand,
  // I2S RX data pin per stereo pair. Set is action-IN with
  // wValue = (pair << 8) | GPIO, 1-byte PinConfigResult.
  I2sRxPin: { legacy: { code: 0xF1 } } satisfies ActionCommand,
  // Active I2S input channel count (2/4/6/8). Set is action-IN with the
  // count in wValue, 1-byte PinConfigResult.
  I2sInputChannels: { legacy: { code: 0xF3 } } satisfies ActionCommand,

  // --- ADAT input config (RP2350). Action-style, same convention as
  // OutputAct.AdatEnable/AdatPin: SETs carry the value in wValue and return a
  // 1-byte PinConfigResult status.
  AdatInputEnable: { legacy: { code: 0x68 } } satisfies ActionCommand,
  AdatInputPin: { legacy: { code: 0x6A } } satisfies ActionCommand,
  AdatInputClockMode: { legacy: { code: 0x6C } } satisfies ActionCommand,
} as const;
