const TAU_MS = 300;
/** Rise over the running average, in dB, that counts as a hit. */
const RISE_DB = 4;
/** Rise at which a hit reaches full weight. */
const RISE_FULL_DB = 12;
const FLOOR_DB = -50;
/** A hit must also rise this much within a single reading, so fades never fire. */
const STEP_DB = 3;
const REFRACTORY_MS = 120;
/** A longer gap than this is a stall: the average restarts instead of reading a hit. */
const STALL_MS = 1000;
const MIN_STRENGTH = 0.3;
const MIN_PEAK = 1e-6;

/** Picks transients (kick, snare) out of a stream of peak readings, with no smoothing on the trigger. */
export class OnsetDetector {
  private avgDb = 0;
  private prevDb = 0;
  private lastMs = 0;
  private lastStrikeMs = -Infinity;
  private primed = false;

  /** Feeds one reading (linear amplitude); returns a strike strength in 0..1, or 0 for none. */
  sample(peakLinear: number, nowMs: number): number {
    const db = 20 * Math.log10(Math.max(peakLinear, MIN_PEAK));
    if (!this.primed || nowMs - this.lastMs > STALL_MS || nowMs < this.lastMs) {
      this.primed = true;
      this.avgDb = Math.max(db, FLOOR_DB);
      this.prevDb = db;
      this.lastMs = nowMs;
      return 0;
    }
    const excess = db - this.avgDb;
    const step = db - this.prevDb;
    // The average rests at the floor, so silence does not make every later level a hit.
    this.avgDb += (Math.max(db, FLOOR_DB) - this.avgDb) * (1 - Math.exp(-(nowMs - this.lastMs) / TAU_MS));
    this.prevDb = db;
    this.lastMs = nowMs;
    if (excess < RISE_DB || step < STEP_DB || db < FLOOR_DB || nowMs - this.lastStrikeMs < REFRACTORY_MS) return 0;
    this.lastStrikeMs = nowMs;
    this.avgDb = db;
    const t = Math.min(1, Math.max(0, (excess - RISE_DB) / (RISE_FULL_DB - RISE_DB)));
    return t * (1 - MIN_STRENGTH) + MIN_STRENGTH;
  }
}
