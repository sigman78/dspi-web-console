import { Codec } from '@/utils';
import type { DacHwMute } from '@/domain';
import * as Wire from '../wireTypes';
import { tighten } from './tighten';
import type { ActionCommand, Command, RawCommand } from './types';

export const OutputCmd = {
  // --- Selectable output latency (fw 1.1.6 release head). ---
  // OUT: 1-byte option id (unknown ids ignored; deferred apply). IN is
  // wValue-multiplexed: GET_STATUS -> OutputLatencyStatus, GET_OPTIONS ->
  // optionCount x OutputLatencyOption (parsed by DspDevice). Older firmware
  // STALLs the opcode, which is the feature probe.
  OutputLatency: { legacy: { get: 0x03, set: 0x03 } } satisfies RawCommand,

  // --- Output pin and type (action-style IN: args in wValue, 1-byte value).
  // See docs/PINS-CONFIG.md. ---
  OutputPin: { legacy: { get: 0x7D } } satisfies RawCommand,
  OutputType: { legacy: { get: 0xC1 } } satisfies RawCommand,

  // --- ADAT lightpipe bulk output (RP2350). Opcodes 0xCA-0xCE were I2S-DIN
  // opcodes on a deleted fw branch; on fw >= 1.1.5 they are ADAT. ---
  AdatEnable: { codec: Codec.bool8, legacy: { get: 0xCB } } satisfies Command<boolean>,
  AdatPin: { codec: Codec.u8, legacy: { get: 0xCD } } satisfies Command<number>,
  AdatStatus: { codec: Wire.AdatStatus, legacy: { get: 0xCE } },

  DacHwMute: { codec: tighten<DacHwMute>(Wire.DacHwMute), legacy: { get: 0xEB, set: 0xEA } } satisfies Command<DacHwMute>,
} as const;

export const OutputAct = {
  // SET: args in wValue, 1-byte status.
  OutputPin: { legacy: { code: 0x7C } } satisfies ActionCommand,
  OutputType: { legacy: { code: 0xC0 } } satisfies ActionCommand,

  // ADAT SETs carry the value in wValue and return a 1-byte PinConfigResult
  // status (same convention as SpdifRxPin and I2sBckPin).
  AdatEnable: { legacy: { code: 0xCA } } satisfies ActionCommand,
  AdatPin: { legacy: { code: 0xCC } } satisfies ActionCommand,

  // DAC hardware mute test.
  TestDacHwMute: { legacy: { code: 0xEC } } satisfies ActionCommand,
} as const;
