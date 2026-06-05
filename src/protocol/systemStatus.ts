// Parser side of the GetStatus packet (vendor request 0x50).
// wValue=9 returns the variable-length combined "peaks + cpu + clip" packet
// (peaks count varies per platform); other wValues each return a small
// fixed-width scalar. Synthesizer side in `./systemStatus.syn.ts`.

import { Codec } from '@/utils';
import * as Wire from './wireTypes';
import type { ChannelId } from '@/domain';

export interface SystemStatus {
  peaks: Float32Array;     // length 11, normalized 0..1
  cpu0: number;            // 0..100
  cpu1: number;            // 0..100
  clipFlags: number;       // raw bitmask
  isClipping(channel: ChannelId): boolean;
}

export function parseSystemStatus(buffer: Uint8Array, numCh: number): SystemStatus {
  const safeNumCh = Math.min(numCh, Wire.Const.NUM_CHANNELS);
  const codec = Wire.SystemStatus(safeNumCh);
  const peaksRegion = safeNumCh * 2;
  const w = Codec.decode(codec, alignedPad(buffer, Codec.sizeOf(codec), peaksRegion));

  const peaks = new Float32Array(Wire.Const.NUM_CHANNELS);
  for (let i = 0; i < safeNumCh; i++) peaks[i] = w.peaks[i] / 32767;

  const { cpu0, cpu1, clipFlags } = w;
  return {
    peaks, cpu0, cpu1, clipFlags,
    isClipping(channel: ChannelId) {
      return (clipFlags & (1 << channel)) !== 0;
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
