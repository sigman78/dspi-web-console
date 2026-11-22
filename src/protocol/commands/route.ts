import { Codec } from '@/utils';
import type { InputSlot, OutputSlot, MasterVolumeMode } from '@/domain';
import * as Wire from '../wireTypes';
import { tighten } from './tighten';
import type { ActionCommand, Command } from './types';

type MatrixRoutePayload = {
  input: InputSlot; output: OutputSlot;
  enabled: boolean; phaseInvert: boolean; gainDb: number;
};

export const RouteCmd = {
  // Global preamp (legacy)
  Preamp: { codec: Codec.f32, legacy: { get: 0x45, set: 0x44 } } satisfies Command<number>,

  // Channel names (round-trip; bulk read covers the same field too).
  ChannelName: { codec: Wire.ChannelName, legacy: { get: 0x9C, set: 0x9B } } satisfies Command<string>,

  // Per-channel preamp + master volume
  InputPreamp: { codec: Codec.f32, legacy: { get: 0xD1, set: 0xD0 } } satisfies Command<number>,
  MasterVolume: { codec: Codec.f32, legacy: { get: 0xD3, set: 0xD2 } } satisfies Command<number>,
  // Master volume mode: 0 = independent/global, 1 = with-preset.
  MasterVolumeMode: { codec: tighten<MasterVolumeMode>(Codec.u8), legacy: { get: 0xD5, set: 0xD4 } } satisfies Command<MasterVolumeMode>,
  SavedMasterVolume: { codec: Codec.f32, legacy: { get: 0xD7 } } satisfies Command<number>,

  // Matrix mixer (0x70-0x79). See docs/mixer.md.
  // Per-output ops (0x72..0x79) carry the output index in wValue.
  // Matrix-route ops carry input/output in the payload (Set) or pack them
  // into wValue as `(input << 8) | output` (Get).
  MatrixRoute: { codec: tighten<MatrixRoutePayload>(Wire.MatrixRoutePacket), legacy: { get: 0x71, set: 0x70 } } satisfies Command<MatrixRoutePayload>,
  OutputEnable: { codec: Codec.bool8, legacy: { get: 0x73, set: 0x72 } } satisfies Command<boolean>,
  OutputGain: { codec: Codec.f32, legacy: { get: 0x75, set: 0x74 } } satisfies Command<number>,
  OutputMute: { codec: Codec.bool8, legacy: { get: 0x77, set: 0x76 } } satisfies Command<boolean>,
  OutputDelay: { codec: Codec.f32, legacy: { get: 0x79, set: 0x78 } } satisfies Command<number>,
  // User volume/mute (granular surface, docs/HW-DSPUSB.md).
  UserVolume: { codec: Codec.f32, legacy: { get: 0xDB, set: 0xDA } } satisfies Command<number>,
  UserMute: { codec: Codec.bool8, legacy: { get: 0xDD, set: 0xDC } } satisfies Command<boolean>,
} as const;

export const RouteAct = {
  // Action-style IN: persists current live master volume to flash, returns 1-byte status.
  SaveMasterVolume: { legacy: { code: 0xD6 } } satisfies ActionCommand,
} as const;
