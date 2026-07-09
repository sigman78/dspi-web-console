// ISO 226:2003 loudness compensation curve, ported from the macOS reference
// app's CompensationCurveView. The reference uses a fixed representative
// listening volume 40 dB below the reference SPL; the console needs the
// resulting gain on the 201-bin BODE_FREQS grid, so gain is computed at the
// 30 ISO frequencies and interpolated (linear in dB over log-frequency).

import { BODE_FREQS } from './bodeFreqs';

interface IsoRow { f: number; af: number; lu: number; tf: number; }

// ISO 226:2003 coefficients (verbatim from the macOS reference).
const ISO_TABLE: readonly IsoRow[] = [
  { f: 20, af: 0.532, lu: -31.6, tf: 78.5 }, { f: 25, af: 0.506, lu: -27.2, tf: 68.7 },
  { f: 31.5, af: 0.480, lu: -23.0, tf: 59.5 }, { f: 40, af: 0.455, lu: -19.1, tf: 51.1 },
  { f: 50, af: 0.432, lu: -15.9, tf: 44.0 }, { f: 63, af: 0.409, lu: -13.0, tf: 37.5 },
  { f: 80, af: 0.387, lu: -10.3, tf: 31.5 }, { f: 100, af: 0.367, lu: -8.1, tf: 26.5 },
  { f: 125, af: 0.349, lu: -6.2, tf: 22.1 }, { f: 160, af: 0.330, lu: -4.5, tf: 17.9 },
  { f: 200, af: 0.315, lu: -3.1, tf: 14.4 }, { f: 250, af: 0.301, lu: -2.0, tf: 11.4 },
  { f: 315, af: 0.288, lu: -1.1, tf: 8.6 }, { f: 400, af: 0.276, lu: -0.4, tf: 6.2 },
  { f: 500, af: 0.267, lu: 0.0, tf: 4.4 }, { f: 630, af: 0.259, lu: 0.3, tf: 3.0 },
  { f: 800, af: 0.253, lu: 0.5, tf: 2.2 }, { f: 1000, af: 0.250, lu: 0.0, tf: 2.4 },
  { f: 1250, af: 0.246, lu: -2.7, tf: 3.5 }, { f: 1600, af: 0.244, lu: -4.1, tf: 1.7 },
  { f: 2000, af: 0.243, lu: -1.0, tf: -1.3 }, { f: 2500, af: 0.243, lu: 1.7, tf: -4.2 },
  { f: 3150, af: 0.243, lu: 2.5, tf: -6.0 }, { f: 4000, af: 0.242, lu: 1.2, tf: -5.4 },
  { f: 5000, af: 0.242, lu: -2.1, tf: -1.5 }, { f: 6300, af: 0.245, lu: -7.1, tf: 6.0 },
  { f: 8000, af: 0.254, lu: -11.2, tf: 12.6 }, { f: 10000, af: 0.271, lu: -10.7, tf: 13.9 },
  { f: 12500, af: 0.301, lu: -3.1, tf: 12.3 }, { f: 16000, af: 0.310, lu: -2.0, tf: 17.0 },
];

function iso226Spl(tf: number, af: number, lu: number, phon: number): number {
  const B = 0.4 * Math.pow(10, (tf + lu) / 10 - 9);
  const threshold = Math.pow(B, af);
  const Af = Math.max(4.47e-3 * (Math.pow(10, 0.025 * phon) - 1.15) + threshold, 1e-10);
  return (10 / af) * Math.log10(Af) - lu + 94;
}

function compensationDb(row: IsoRow, refSpl: number, effectivePhon: number, intensity: number): number {
  if (effectivePhon >= refSpl) return 0;
  const splRef = iso226Spl(row.tf, row.af, row.lu, refSpl);
  const splEff = iso226Spl(row.tf, row.af, row.lu, effectivePhon);
  const flat = effectivePhon - refSpl;
  const delta = splEff - splRef;
  return (delta - flat) * (intensity / 100);
}

// Loudness compensation curve (dB) sampled at BODE_FREQS.
export function loudnessResponse(refSpl: number, intensityPct: number): number[] {
  const effectivePhon = Math.min(Math.max(refSpl - 40, 20), refSpl);
  const isoGains = ISO_TABLE.map((row) => ({ f: row.f, g: compensationDb(row, refSpl, effectivePhon, intensityPct) }));
  // Interpolate onto BODE_FREQS in log-frequency, linear in dB, clamped at edges.
  return BODE_FREQS.map((f) => {
    if (f <= isoGains[0].f) return isoGains[0].g;
    if (f >= isoGains[isoGains.length - 1].f) return isoGains[isoGains.length - 1].g;
    let hi = 1;
    while (hi < isoGains.length && isoGains[hi].f < f) hi++;
    const a = isoGains[hi - 1], b = isoGains[hi];
    const t = (Math.log(f) - Math.log(a.f)) / (Math.log(b.f) - Math.log(a.f));
    return a.g + t * (b.g - a.g);
  });
}
