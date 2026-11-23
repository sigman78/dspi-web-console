import { Codec } from '@/utils';
import * as Wire from '../wireTypes';
import { tighten } from './tighten';
import type { Command, RawCommand } from './types';

type UpmixConfigPayload = {
  enabled: boolean; centerMode: number; surroundMode: number; presenceQ1: number;
  strengthPct: number; centerWidthPct: number; corrThresholdPct: number;
  attackMs: number; releaseMs: number; detectorHpfHz: number;
  surroundDelayMs: number; surroundHpfHz: number; surroundLpfHz: number;
  decorrPct: number;
};

export const FxCmd = {
  // --- V29/V30 subharmonic synthesizer (fw 1.1.6, both platforms). ---
  SubharmEnabled: { codec: Codec.bool8, legacy: { get: 0x11, set: 0x10 } } satisfies Command<boolean>,
  SubharmLow: { codec: Codec.f32, legacy: { get: 0x13, set: 0x12 } } satisfies Command<number>,
  SubharmHigh: { codec: Codec.f32, legacy: { get: 0x15, set: 0x14 } } satisfies Command<number>,
  SubharmBoost: { codec: Codec.f32, legacy: { get: 0x17, set: 0x16 } } satisfies Command<number>,
  SubharmMask: { codec: Codec.u16, legacy: { get: 0x19, set: 0x18 } } satisfies Command<number>,
  // Live worst-case gain (dB) of the current config; read-only.
  SubharmHeadroom: { codec: Codec.f32, legacy: { get: 0x1A } } satisfies Command<number>,
  // V30 tail: third band, selectivity gate, sub ceiling, pair link.
  SubharmTop: { codec: Codec.f32, legacy: { get: 0x1C, set: 0x1B } } satisfies Command<number>,
  SubharmSelect: { codec: Codec.u8, legacy: { get: 0x1E, set: 0x1D } } satisfies Command<number>,
  // Live per-output sub meter: NUM_OUTPUT_CHANNELS x u16 LE, variable length.
  SubharmMeter: { legacy: { get: 0x1F } } satisfies RawCommand,
  // Runtime-only solo monitor: never on the wire's bulk section, not persisted,
  // no notify.
  SubharmSolo: { codec: Codec.bool8, legacy: { get: 0x2D, set: 0x2C } } satisfies Command<boolean>,
  SubharmLink: { codec: Codec.bool8, legacy: { get: 0x2F, set: 0x2E } } satisfies Command<boolean>,
  SubharmDepth: { codec: Codec.f32, legacy: { get: 0xAA, set: 0xA9 } } satisfies Command<number>,
  SubharmHold: { codec: Codec.f32, legacy: { get: 0xAC, set: 0xAB } } satisfies Command<number>,
  SubharmCeiling: { codec: Codec.f32, legacy: { get: 0xAE, set: 0xAD } } satisfies Command<number>,

  // Crossfeed (V4+) -- firmware feature, deferred. Fields land in firmware order:
  // enable, preset, freq, feed, ITD. Even codes are SET, odd codes are GET.
  CrossfeedEnabled: { codec: Codec.bool8, legacy: { set: 0x5E } } satisfies Command<boolean>,
  CrossfeedPreset: { codec: Codec.u8, legacy: { set: 0x60 } } satisfies Command<number>,
  CrossfeedFreq: { codec: Codec.f32, legacy: { set: 0x62 } } satisfies Command<number>,
  CrossfeedFeedDb: { codec: Codec.f32, legacy: { set: 0x64 } } satisfies Command<number>,
  CrossfeedItd: { codec: Codec.bool8, legacy: { set: 0x66 } } satisfies Command<boolean>,
  // Crossfeed output-pair mask: payload = u8, bit p = output pair p
  // (outputs 2p/2p+1; the mono PDM sub is excluded).
  CrossfeedOutputs: { codec: Codec.u8, legacy: { get: 0xFD, set: 0xFC } } satisfies Command<number>,

  // --- Psychoacoustic bass (RP2350). ---
  PsybassEnabled: { codec: Codec.bool8, legacy: { get: 0x31, set: 0x30 } } satisfies Command<boolean>,
  PsybassCutoff: { codec: Codec.f32, legacy: { get: 0x33, set: 0x32 } } satisfies Command<number>,
  PsybassHarmonics: { codec: Codec.f32, legacy: { get: 0x35, set: 0x34 } } satisfies Command<number>,
  PsybassDrive: { codec: Codec.f32, legacy: { get: 0x37, set: 0x36 } } satisfies Command<number>,
  PsybassCharacter: { codec: Codec.f32, legacy: { get: 0x39, set: 0x38 } } satisfies Command<number>,
  PsybassOriginal: { codec: Codec.f32, legacy: { get: 0x3B, set: 0x3A } } satisfies Command<number>,
  PsybassMask: { codec: Codec.u16, legacy: { get: 0x3D, set: 0x3C } } satisfies Command<number>,

  // --- Stereo upmixer (RP2350 only). ---
  // Config pair carries the 44-byte struct shared with the bulk section
  // (Wire.UpmixParams); no DspDevice methods yet -- values arrive via the
  // bulk section like the ADAT input config. Registered for
  // completeness / MockTransport round-trip.
  UpmixConfig: { codec: tighten<UpmixConfigPayload>(Wire.UpmixParams), legacy: { get: 0x4B, set: 0x4A } } satisfies Command<UpmixConfigPayload>,
  // Per-param SET/GET: wValue = UPMIX_PARAM_* id (Wire.UpmixParam), payload/
  // response = one float; firmware rounds mode/enable ids to integer on SET.
  UpmixParam: { codec: Codec.f32, legacy: { get: 0x4D, set: 0x4C } } satisfies Command<number>,
  // Live status (no bulk equivalent).
  UpmixStatus: { codec: Wire.UpmixStatus, legacy: { get: 0x4E } },
} as const;
