// One-pole complementary crossfeed response, ported from the macOS reference
// app's CrossfeedCurveView. Produces the crossfeed (lowpass) path and the
// direct (complementary) path in dB, sampled at BODE_FREQS.

import { BODE_FREQS } from './bodeFreqs';

const FS = 48000;

export function crossfeedResponse(freqHz: number, feedDb: number): { crossfeed: number[]; direct: number[] } {
  const levelRatio = Math.pow(10, feedDb / 20);
  const G = 1 / (1 + levelRatio);
  const lpX = Math.exp(-2 * Math.PI * freqHz / FS);
  const lpA0 = G * (1 - lpX);

  const crossfeed = new Array<number>(BODE_FREQS.length);
  const direct = new Array<number>(BODE_FREQS.length);
  for (let i = 0; i < BODE_FREQS.length; i++) {
    const omega = 2 * Math.PI * BODE_FREQS[i] / FS;
    // Lowpass H(z) = a0 / (1 - lpX z^-1)
    const denRe = 1 - lpX * Math.cos(omega);
    const denIm = lpX * Math.sin(omega);
    const denMag2 = denRe * denRe + denIm * denIm;
    const lpRe = (lpA0 * denRe) / denMag2;
    const lpIm = (-lpA0 * denIm) / denMag2;
    const lpMag = Math.hypot(lpRe, lpIm);
    crossfeed[i] = 20 * Math.log10(Math.max(lpMag, 1e-10));
    // Direct = 1 - Lowpass (complementary)
    const dRe = 1 - lpRe;
    const dIm = -lpIm;
    direct[i] = 20 * Math.log10(Math.max(Math.hypot(dRe, dIm), 1e-10));
  }
  return { crossfeed, direct };
}
