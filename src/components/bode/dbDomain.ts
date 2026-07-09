// Centered [min,max] dB domain for a set of curves: spans the data, widened to
// at least minSpan dB, then padded by padFrac on each side. Mirrors the macOS
// dynamic-domain logic so flat responses don't zoom into noise.
export function centeredDbDomain(curves: number[][], minSpan = 10, padFrac = 0.2): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const c of curves) for (const v of c) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!isFinite(lo) || !isFinite(hi)) return [-minSpan / 2, minSpan / 2];
  const span = Math.max(hi - lo, minSpan);
  const mid = (lo + hi) / 2;
  const half = span / 2;
  const pad = span * padFrac;
  return [mid - half - pad, mid + half + pad];
}
