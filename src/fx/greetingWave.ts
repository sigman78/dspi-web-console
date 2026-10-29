import { BAND_COUNT } from './bands';

const SWEEP_MS = 800;
// A hint, not a signal: well under the room light's bass response.
const HEIGHT = 0.075;
const WIDTH_BANDS = 2.6;
const OVERSHOOT_BANDS = 4;

/**
 * A one-shot bump that sweeps the spectrum from bass to treble, so a silent display still shows
 * it is alive. It sits between a feed and the scene and only ever raises a band (max-combine),
 * so real signal arriving mid-sweep simply wins.
 */
export class GreetingWave {
  private startMs = -1;
  private readonly out = new Float32Array(BAND_COUNT);

  start(nowMs: number): void {
    this.startMs = nowMs;
  }

  /** The bands with the wave mixed in; returns `bands` itself while no sweep is running. */
  apply(nowMs: number, bands: Float32Array): Float32Array {
    if (this.startMs < 0) return bands;
    const t = (nowMs - this.startMs) / SWEEP_MS;
    if (t >= 1) {
      this.startMs = -1;
      return bands;
    }
    if (t < 0) return bands;
    const eased = t * t * (3 - 2 * t);
    const centre = -OVERSHOOT_BANDS + eased * (BAND_COUNT - 1 + 2 * OVERSHOOT_BANDS);
    const height = HEIGHT * Math.sin(Math.PI * t);
    for (let i = 0; i < BAND_COUNT; i++) {
      const d = (i - centre) / WIDTH_BANDS;
      this.out[i] = Math.max(bands[i], height * Math.exp(-d * d));
    }
    return this.out;
  }
}
