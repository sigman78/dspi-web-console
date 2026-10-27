// Pure plot-geometry helpers shared by BodePlot and the interactive EQ graph.
// Pixel coordinates are in the plot's SVG viewBox space.

import * as Eq from '../eqLimits';

export type PlotGeometry = {
  padL: number;
  plotW: number;
  plotH: number;
  yMin: number;
  yMax: number;
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const LOG_SPAN = Math.log(Eq.FREQ_MAX_HZ / Eq.FREQ_MIN_HZ);

export function xForF(f: number, g: PlotGeometry): number {
  return g.padL + (Math.log(f / Eq.FREQ_MIN_HZ) / LOG_SPAN) * g.plotW;
}

export function fForX(x: number, g: PlotGeometry): number {
  const t = clamp((x - g.padL) / g.plotW, 0, 1);
  if (t >= 1) return Eq.FREQ_MAX_HZ;
  return Eq.FREQ_MIN_HZ * Math.exp(t * LOG_SPAN);
}

export function yForDb(db: number, g: PlotGeometry): number {
  return g.plotH - ((db - g.yMin) / (g.yMax - g.yMin)) * g.plotH;
}

export function dbForY(y: number, g: PlotGeometry): number {
  const db = g.yMin + ((g.plotH - y) / g.plotH) * (g.yMax - g.yMin);
  return clamp(db, g.yMin, g.yMax);
}

/** Multiplicative Q step: x1.1 per 100 px of wheel travel, wheel up (negative deltaY) raises Q. */
export function snapQFromWheel(q: number, deltaY: number): number {
  const next = clamp(q * Math.pow(1.1, -deltaY / 100), Eq.Q_MIN, Eq.Q_MAX);
  return Math.round(next * 100) / 100;
}

/** Legal db span for a node: the plot range intersected with the band-gain range. */
function dbLimits(g: PlotGeometry): [number, number] {
  return [Math.max(g.yMin, Eq.BAND_GAIN_MIN_DB), Math.min(g.yMax, Eq.BAND_GAIN_MAX_DB)];
}

export function dragToParams(
  node: { f: number; db: number; lockDb?: boolean },
  x: number,
  y: number,
  g: PlotGeometry,
): { f: number; db: number } {
  const [lo, hi] = dbLimits(g);
  return {
    f: fForX(x, g),
    db: node.lockDb ? node.db : clamp(dbForY(y, g), lo, hi),
  };
}

/** Keyboard nudge: f moves 2 % per press, db 0.1 (1 with coarse). */
export function nudgeParams(
  node: { f: number; db: number; lockDb?: boolean },
  key: string,
  coarse: boolean,
  g: PlotGeometry,
): { f: number; db: number } | null {
  let { f, db } = node;
  switch (key) {
    case 'ArrowLeft':
      f /= 1.02;
      break;
    case 'ArrowRight':
      f *= 1.02;
      break;
    case 'ArrowUp':
    case 'ArrowDown': {
      if (node.lockDb) return null;
      const step = (coarse ? 1 : 0.1) * (key === 'ArrowUp' ? 1 : -1);
      db = Math.round((db + step) * 10) / 10;
      break;
    }
    default:
      return null;
  }
  const [lo, hi] = dbLimits(g);
  return { f: clamp(f, Eq.FREQ_MIN_HZ, Eq.FREQ_MAX_HZ), db: clamp(db, lo, hi) };
}
