// Synthesizer side of the GetStatus packet (encode); the parser is in
// `./systemStatus.ts`. Both share the `SystemStatus(numCh)` schema in
// `./wireTypes.ts`.

import { Codec } from '@/utils';
import * as Wire from './wireTypes';

// Synth a single u32 scalar response (wValue from {3..8, 13..15, 17..21}).
export function synthesizeU32(v: number): Uint8Array {
  return Codec.encode(Codec.u32, v >>> 0);
}

// Synth a single i32 scalar response (wValue=16).
export function synthesizeI32(v: number): Uint8Array {
  return Codec.encode(Codec.i32, v | 0);
}

export interface SynthesizeStatusOptions {
  numCh: number;            // platform-specific (7 on RP2040, 11/17 on RP2350)
  peaks?: number[];         // 0..1, length numCh; missing entries -> 0
  cpu0?: number;
  cpu1?: number;
  clipFlags?: number;
  // Present -> V16 wide layout (u32 clip flags + trailing count byte).
  activeInputChannels?: number;
}

export function synthesizeSystemStatus(opts: SynthesizeStatusOptions): Uint8Array {
  const peaks = Array.from({ length: opts.numCh }, (_, i) =>
    Math.round((opts.peaks?.[i] ?? 0) * 32767),
  );
  const common = {
    peaks,
    cpu0:      opts.cpu0      ?? 0,
    cpu1:      opts.cpu1      ?? 0,
    clipFlags: opts.clipFlags ?? 0,
  };
  return opts.activeInputChannels != null
    ? Codec.encode(Wire.SystemStatus16(opts.numCh), { ...common, activeInputChannels: opts.activeInputChannels })
    : Codec.encode(Wire.SystemStatus(opts.numCh), common);
}
