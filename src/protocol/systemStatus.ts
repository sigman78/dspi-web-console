// Parser side of the GetStatus packet (vendor request 0x50).
// wValue=9 returns the variable-length combined "peaks + cpu + clip" packet
// (peaks count varies per platform); other wValues each return a small
// fixed-width scalar (u32 / i32 / mV / Hz). See docs/system-status-req.md
// and the `SystemStatusValue` enum in `./wireTypes.ts`.
//
// Wire schema for the combined packet in `wireTypes.ts`
// (`WireSystemStatus(numCh)`).
// Spec: docs/HW-INTERFACE.md sec."systemStatus.ts".
//
// The synthesizer side is in `./systemStatus.syn.ts`.

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

// Make a `target`-byte buffer the codec can decode, preserving v1's
// lenient short-buffer semantics:
//   - missing tail bytes are zero (so cpu/clip default to 0 on truncation),
//   - a trailing odd byte inside the peaks region is dropped rather than
//     letting it be half-read into a partial u16 peak,
//   - any cpu/clip bytes that did arrive after the peaks region are
//     splaced back at their natural offset, regardless of how many
//     peak bytes were present.
//
// If `buf.byteLength >= target` the original buffer is returned (the
// codec ignores trailing bytes past `target`).
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
