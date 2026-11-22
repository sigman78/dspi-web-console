import { Codec } from '@/utils';
import type { OutputConfigMode } from '@/domain';
import * as Wire from '../wireTypes';
import { tighten } from './tighten';
import type { ActionCommand, Command, RawCommand } from './types';

export const StoreCmd = {
  // Bulk
  AllParams: { legacy: { get: 0xA0, set: 0xA1 } } satisfies RawCommand,
  // Chunked bulk access (fw 1.1.5+): wValue = byte offset, chunks
  // <= 4096 B. A session is torn down by any interleaved non-chunk vendor
  // request; see DspDevice.getAllParams/setAllParams.
  AllParamsChunk: { legacy: { get: 0xA2, set: 0xA3 } } satisfies RawCommand,

  // Presets (0x90..0x9A). See docs/HW-PROFILES.md sec 1b.
  // PresetDirectory / PresetActive carry hand-rolled payloads; the others
  // are codec-driven or action-IN (see StoreAct).
  PresetName: { codec: Wire.ChannelName, legacy: { get: 0x93, set: 0x94 } } satisfies Command<string>,
  PresetDirectory: { legacy: { get: 0x95 } } satisfies RawCommand,
  PresetStartup: { codec: Wire.PresetStartupConfig, legacy: { get: 0x97, set: 0x96 } } satisfies Command<{ mode: number; slot: number }>,
  // Output-config persistence mode (1.1.4 semantics). Deliberately
  // ungated: the opcode exists across the whole support window.
  OutputConfigMode: { codec: tighten<OutputConfigMode>(Codec.u8), legacy: { get: 0x99, set: 0x98 } } satisfies Command<OutputConfigMode>,
  PresetActive: { legacy: { get: 0x9A } } satisfies RawCommand,
} as const;

export const StoreAct = {
  // Persistence (action-style IN; return 1-byte FlashResult).
  // On V3+ firmware these redirect through the preset system on the
  // currently-active slot. See docs/HW-PROFILES.md sec 2.
  SaveParams: { legacy: { code: 0x51 } } satisfies ActionCommand,
  FactoryReset: { legacy: { code: 0x53 } } satisfies ActionCommand,

  // Preset slot actions: wValue = slot.
  PresetSave: { legacy: { code: 0x90 } } satisfies ActionCommand,
  PresetLoad: { legacy: { code: 0x91 } } satisfies ActionCommand,
  PresetDelete: { legacy: { code: 0x92 } } satisfies ActionCommand,
  // Persist live output config (pins, output types, I2S BCK/MCK, S/PDIF RX
  // pin) to the preset directory's device-global block. Action-IN, 1-byte
  // PresetResult. Repurposes legacy 0x52 (the removed sync LoadParams).
  SaveOutputConfig: { legacy: { code: 0x52 } } satisfies ActionCommand,
} as const;
