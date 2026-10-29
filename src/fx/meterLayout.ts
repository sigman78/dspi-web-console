const SLAB_MIN = 14;
const SLAB_MAX = 56;
const INTRA_GAP = 0.35;
const INTER_GAP = 1.2;
const STRIDE_FILL = 0.62;

export interface MeterLayout {
  slabW: number;
  /** Left edge of each slab, relative to the wall's left edge. */
  x: Float32Array;
}

/**
 * Slab width and positions for a centred row of meters. `group[i]` is slot
 * i's group index (non-decreasing); slots in one group sit closer than
 * neighbouring groups. The width never drops below the minimum, so a very
 * narrow wall overflows symmetrically instead of shrinking slabs to nothing.
 */
export function layoutMeters(group: ArrayLike<number>, width: number): MeterLayout {
  const n = group.length;
  if (n === 0) return { slabW: 0, x: new Float32Array(0) };

  let gapUnits = 0;
  for (let i = 1; i < n; i++) gapUnits += group[i] === group[i - 1] ? INTRA_GAP : INTER_GAP;
  const fit = width / (n + gapUnits);
  const slabW = Math.max(SLAB_MIN, Math.min(SLAB_MAX, fit, (STRIDE_FILL * width) / n));

  const x = new Float32Array(n);
  let cursor = (width - (n + gapUnits) * slabW) / 2;
  for (let i = 0; i < n; i++) {
    if (i > 0) cursor += slabW + (group[i] === group[i - 1] ? INTRA_GAP : INTER_GAP) * slabW;
    x[i] = cursor;
  }
  return { slabW, x };
}
