import { Codec } from '@/utils';
import * as Wire from '../wireTypes';
import type { Command, RawCommand } from './types';

type LevellerMasksPayload = { detector: number; apply: number };

export const DynCmd = {
  // Loudness (V4+) -- firmware feature, deferred
  LoudnessEnabled: { codec: Codec.bool8, legacy: { set: 0x58 } } satisfies Command<boolean>,
  LoudnessRefSpl: { codec: Codec.f32, legacy: { set: 0x5A } } satisfies Command<number>,
  LoudnessIntensity: { codec: Codec.f32, legacy: { set: 0x5C } } satisfies Command<number>,
  // Per-output loudness mask: payload = u16 LE, bit k = output channel k.
  LoudnessMask: { codec: Codec.u16, legacy: { get: 0xFB, set: 0xFA } } satisfies Command<number>,

  // Volume Leveller (V4+) -- firmware feature, deferred. Fields land in firmware
  // order: enable, amount, speed, max gain, lookahead, gate.
  LevellerEnabled: { codec: Codec.bool8, legacy: { set: 0xB4 } } satisfies Command<boolean>,
  LevellerAmount: { codec: Codec.f32, legacy: { set: 0xB6 } } satisfies Command<number>,
  LevellerSpeed: { codec: Codec.u8, legacy: { set: 0xB8 } } satisfies Command<number>,
  LevellerMaxGain: { codec: Codec.f32, legacy: { set: 0xBA } } satisfies Command<number>,
  LevellerLookahead: { codec: Codec.bool8, legacy: { set: 0xBC } } satisfies Command<boolean>,
  LevellerGate: { codec: Codec.f32, legacy: { set: 0xBE } } satisfies Command<number>,
  // Multichannel leveller masks: payload = [detector_mask, apply_mask].
  LevellerMasks: { codec: Wire.LevellerMasks, legacy: { get: 0xDF, set: 0xDE } } satisfies Command<LevellerMasksPayload>,

  // --- V32 per-output limiter (fw 1.1.6-beta4, both platforms). ---
  // One opcode, both directions. SET: wValue = limiterWValue(output, index),
  // payload = one float32 for every parameter (bool/enum included). GET: same
  // wValue -> one float32, or a read-only block selected by the index byte
  // (Wire.LIMITER_GET_METER / LIMITER_GET_STATUS). Direction-split helpers
  // live on DspDevice.
  Limiter: { legacy: { get: 0x81, set: 0x81 } } satisfies RawCommand,
} as const;
