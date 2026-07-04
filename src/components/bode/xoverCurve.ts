// Crossover-band biquad synthesis for the Bode plot, mirroring the firmware's
// design pipeline (crossover.c): normalized analog pole placement per family,
// frequency prewarping at the filter level, bilinear transform per section.
// Magnitude is composition-invariant, so matching the pole placement matches
// the device response regardless of its SVF/TDF2 realization choice.

import { FilterType, XOVER_TYPE_FIRST, isCrossoverType } from '@/domain';
import type { BiquadCoeffs } from './filterCurve';

interface PolePair { sigma: number; omega: number; }

interface XoverMeta {
  family: 'lr' | 'bw' | 'bes';
  order: number;
  isHp: boolean;
}

// Indexed by (type - XOVER_TYPE_FIRST); mirrors the firmware xover_type_table.
const XOVER_META: readonly XoverMeta[] = [
  ...[2, 4, 6, 8].flatMap((order): XoverMeta[] => [
    { family: 'lr', order, isHp: false }, { family: 'lr', order, isHp: true },
  ]),
  ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap((order): XoverMeta[] => [
    { family: 'bw', order, isHp: false }, { family: 'bw', order, isHp: true },
  ]),
  ...[2, 4, 6, 8].flatMap((order): XoverMeta[] => [
    { family: 'bes', order, isHp: false }, { family: 'bes', order, isHp: true },
  ]),
];

// Bessel (-3 dB magnitude-normalized) pole tables, copied from crossover.c
// (verified there against scipy signal.bessel(..., norm='mag')).
const BESSEL_PAIRS: Record<number, PolePair[]> = {
  2: [{ sigma: 1.10160, omega: 0.63601 }],
  4: [{ sigma: 1.37007, omega: 0.41025 }, { sigma: 0.99521, omega: 1.25711 }],
  6: [{ sigma: 1.57149, omega: 0.32090 }, { sigma: 1.38186, omega: 0.97147 }, { sigma: 0.93066, omega: 1.66186 }],
  8: [{ sigma: 1.75741, omega: 0.27287 }, { sigma: 1.63694, omega: 0.82280 }, { sigma: 1.37384, omega: 1.38836 }, { sigma: 0.89287, omega: 1.99833 }],
};

// Butterworth pole pairs on the unit circle. Odd orders additionally carry a
// real pole at sigma = 1, returned separately.
function butterworthPairs(order: number): PolePair[] {
  const pairs: PolePair[] = [];
  const nPairs = order >> 1;
  for (let k = 0; k < nPairs; k++) {
    const theta = order & 1
      ? Math.PI * (k + 1) / order
      : Math.PI * (2 * k + 1) / (2 * order);
    pairs.push({ sigma: Math.cos(theta), omega: Math.sin(theta) });
  }
  return pairs;
}

// Normalized analog prototype as { pairs, realPoles } for one crossover type.
function analogPrototype(meta: XoverMeta): { pairs: PolePair[]; realPoles: number[] } {
  switch (meta.family) {
    case 'bw': {
      const pairs = butterworthPairs(meta.order);
      return { pairs, realPoles: meta.order & 1 ? [1] : [] };
    }
    case 'lr': {
      // LR(N) = BW(N/2) squared: every half-order pole doubled.
      const half = meta.order >> 1;
      const bw = butterworthPairs(half);
      const pairs = bw.flatMap((p) => [p, p]);
      const realPoles = half & 1 ? [1, 1] : [];
      return { pairs, realPoles };
    }
    case 'bes':
      return { pairs: BESSEL_PAIRS[meta.order] ?? [], realPoles: [] };
  }
}

// Bilinear transform of one analog pole pair (already scaled to rad/s) into a
// digital section. LP zeros sit at z = -1, HP zeros at z = +1; numerators are
// scaled for unity passband gain (w0^2 for LP, K^2 for HP).
function bilinearPair(sigma: number, omega: number, isHp: boolean, K: number): BiquadCoeffs {
  const w02 = sigma * sigma + omega * omega;
  const a0 = K * K + 2 * sigma * K + w02;
  const den1 = (2 * w02 - 2 * K * K) / a0;
  const den2 = (K * K - 2 * sigma * K + w02) / a0;
  if (isHp) {
    const k2 = K * K / a0;
    return { b0: k2, b1: -2 * k2, b2: k2, a1: den1, a2: den2 };
  }
  const n = w02 / a0;
  return { b0: n, b1: 2 * n, b2: n, a1: den1, a2: den2 };
}

// Bilinear transform of one real analog pole (rad/s) into a first-order
// section (degenerate biquad, b2 = a2 = 0).
function bilinearReal(sigma: number, isHp: boolean, K: number): BiquadCoeffs {
  const a0 = K + sigma;
  const a1 = (sigma - K) / a0;
  if (isHp) {
    const k = K / a0;
    return { b0: k, b1: -k, b2: 0, a1, a2: 0 };
  }
  const n = sigma / a0;
  return { b0: n, b1: n, b2: 0, a1, a2: 0 };
}

// Digital biquad cascade for one crossover band. Empty for non-crossover
// types. fc is clamped away from Nyquist so the prewarp tan() stays finite.
export function xoverSectionCoeffs(type: FilterType, fc: number, fs: number): BiquadCoeffs[] {
  if (!isCrossoverType(type)) return [];
  const meta = XOVER_META[type - XOVER_TYPE_FIRST];
  if (!meta) return [];

  const f = Math.min(Math.max(fc, 1), 0.49 * fs);
  const wa = 2 * fs * Math.tan(Math.PI * f / fs);   // prewarped cutoff, rad/s
  const K = 2 * fs;

  const proto = analogPrototype(meta);
  // The analog LP->HP transform s -> wc/s inverts each normalized pole
  // through the unit circle (a no-op for BW/LR whose poles sit on it, but
  // required for Bessel where per-section radii differ). Mirrors the same
  // unconditional reciprocal in the firmware's section_emit path.
  const pairs = meta.isHp
    ? proto.pairs.map((p) => {
        const r2 = p.sigma * p.sigma + p.omega * p.omega;
        return { sigma: p.sigma / r2, omega: p.omega / r2 };
      })
    : proto.pairs;
  const realPoles = meta.isHp ? proto.realPoles.map((s) => 1 / s) : proto.realPoles;
  return [
    ...pairs.map((p) => bilinearPair(p.sigma * wa, p.omega * wa, meta.isHp, K)),
    ...realPoles.map((sigma) => bilinearReal(sigma * wa, meta.isHp, K)),
  ];
}
