/** Display ballistics on a 0..1 scale: fast attack, exponential release, held peak cap that then falls under gravity. */
export interface Ballistics {
  readonly attackMs: number;
  readonly releaseMs: number;
  readonly holdMs: number;
  /** Peak cap fall speed after the hold, in full scales per second. */
  readonly gravityPerS: number;
}

export interface MeterState {
  level: number;
  peak: number;
  holdUntilMs: number;
}

export const SPECTRUM_BALLISTICS: Ballistics = { attackMs: 25, releaseMs: 220, holdMs: 700, gravityPerS: 0.9 };

export function newMeter(): MeterState {
  return { level: 0, peak: 0, holdUntilMs: 0 };
}

/** Advance one meter by dtMs towards target; mutates in place (no allocation). */
export function stepMeter(m: MeterState, target: number, nowMs: number, dtMs: number, b: Ballistics): void {
  const tau = target > m.level ? b.attackMs : b.releaseMs;
  m.level += (target - m.level) * (1 - Math.exp(-dtMs / tau));
  if (m.level >= m.peak) {
    m.peak = m.level;
    m.holdUntilMs = nowMs + b.holdMs;
  } else if (nowMs > m.holdUntilMs) {
    m.peak = Math.max(m.level, m.peak - (b.gravityPerS * dtMs) / 1000);
  }
}
