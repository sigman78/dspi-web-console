// Parser side of the GetStatus packet (vendor request 0x50).
// wValue=9 returns the variable-length combined "peaks + cpu + clip" packet
// (peaks count varies per platform); other wValues each return a small
// fixed-width scalar. Synthesizer side in `./systemStatus.syn.ts`.
//
// Two wire generations: V10 ends with a u16 clip mask; V16 widens the clip
// mask to u32 (17 channels) and appends a live active-input-count byte.

import { Codec } from '@/utils';
import * as Wire from './wireTypes';

// Peaks and the clip bitmask are WIRE-channel indexed (the generation's own
// index space); callers map through the hardware profile's wire mapping.
export interface SystemStatus {
  peaks: Float32Array;     // length 17, normalized 0..1, wire-indexed
  cpu0: number;            // 0..100
  cpu1: number;            // 0..100
  clipFlags: number;       // raw bitmask, wire-channel bits
  // Live active input channel count (V16+; null on V10 devices).
  activeInputChannels: number | null;
  isClipping(wireChannel: number): boolean;
}

// Combined-status request size for a given channel count and generation.
export function systemStatusSize(numCh: number, wide: boolean): number {
  return numCh * 2 + (wide ? 7 : 4);
}

export function parseSystemStatus(buffer: Uint8Array, numCh: number, wide = false): SystemStatus {
  const safeNumCh = Math.min(numCh, Wire.Const16.NUM_CHANNELS);
  const peaksRegion = safeNumCh * 2;

  let rawPeaks: number[], cpu0: number, cpu1: number, clipFlags: number;
  let activeInputChannels: number | null;
  if (wide) {
    const codec = Wire.SystemStatus16(safeNumCh);
    const w = Codec.decode(codec, alignedPad(buffer, Codec.sizeOf(codec), peaksRegion));
    ({ peaks: rawPeaks, cpu0, cpu1, clipFlags } = w);
    activeInputChannels = w.activeInputChannels;
  } else {
    const codec = Wire.SystemStatus(safeNumCh);
    const w = Codec.decode(codec, alignedPad(buffer, Codec.sizeOf(codec), peaksRegion));
    ({ peaks: rawPeaks, cpu0, cpu1, clipFlags } = w);
    activeInputChannels = null;
  }

  const peaks = new Float32Array(Wire.Const16.NUM_CHANNELS);
  for (let i = 0; i < safeNumCh; i++) peaks[i] = rawPeaks[i] / 32767;

  return {
    peaks, cpu0, cpu1, clipFlags, activeInputChannels,
    isClipping(wireChannel: number) {
      return (clipFlags & (1 << wireChannel)) !== 0;
    },
  };
}

// Pad a short buffer to `target` bytes with lenient truncation semantics:
// missing tail bytes read as zero (cpu/clip default to 0), a trailing odd
// byte inside the peaks region is dropped rather than half-read into a u16
// peak, and any cpu/clip bytes that did arrive are placed at their natural
// offset. Buffers already >= target are returned as-is.
function alignedPad(buf: Uint8Array, target: number, peaksRegion: number): Uint8Array {
  if (buf.byteLength >= target) return buf;
  const out = new Uint8Array(target);

  const inPeaks = Math.min(buf.byteLength, peaksRegion) & ~1;  // even-aligned
  if (inPeaks > 0) out.set(buf.subarray(0, inPeaks), 0);

  if (buf.byteLength > peaksRegion) {
    const tail = buf.subarray(peaksRegion, Math.min(buf.byteLength, target));
    out.set(tail, peaksRegion);
  }
  return out;
}
