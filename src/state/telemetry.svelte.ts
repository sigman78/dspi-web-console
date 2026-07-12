import type { BufferStats, PartialSystemInfo } from '@/protocol';
import { ALL_CHANNELS, type SpdifRxStatus, type I2sSlaveStatus } from '@/domain';

// Peaks/holds/clips are DOMAIN-ChannelId indexed (the poll loop remaps from
// the device's wire index space); sized to the full domain id range.
const NUM_CHANNELS = ALL_CHANNELS.length;

// Per-field $state (not $state(object)): each field gets its own signal source.
// The object form was observed to miss subscribers when properties are mutated
// 20x/sec from RAF callbacks.
export class StatusStore {
  peaks = $state<number[]>(Array(NUM_CHANNELS).fill(0));
  peakHoldDb = $state<number[]>(Array(NUM_CHANNELS).fill(-90));
  clipLatched = $state<boolean[]>(Array(NUM_CHANNELS).fill(false));
  cpu0 = $state(0);
  cpu1 = $state(0);
  streaming = $state(false);
  pdmActive = $state(false);
  sequence = $state(0);
  bufferStats = $state<BufferStats | null>(null);
  spdifRxStatus = $state<SpdifRxStatus | null>(null);
  i2sSlaveStatus = $state<I2sSlaveStatus | null>(null);
  info = $state<PartialSystemInfo | null>(null);
  // Live active input channel count (V16+; null = not reported / V10 device).
  activeInputChannels = $state<number | null>(null);
  lastStatusMs = $state(0);
  lastBufferMs = $state(0);
  lastInfoMs = $state(0);
  lastParamMs = $state(0);
  errorCount = $state(0);

  reset(): void {
    for (let i = 0; i < NUM_CHANNELS; i++) {
      this.peaks[i] = 0;
      this.peakHoldDb[i] = -90;
      this.clipLatched[i] = false;
    }
    this.cpu0 = 0;
    this.cpu1 = 0;
    this.streaming = false;
    this.pdmActive = false;
    this.sequence = 0;
    this.bufferStats = null;
    this.spdifRxStatus = null;
    this.i2sSlaveStatus = null;
    this.info = null;
    this.activeInputChannels = null;
    this.lastStatusMs = 0;
    this.lastBufferMs = 0;
    this.lastInfoMs = 0;
    this.lastParamMs = 0;
    this.errorCount = 0;
  }

  // Peak normalization (0..1) with 30 dB/sec hold decay.
  applyPeaks(raw: ArrayLike<number>, nowMs: number): void {
    const dt = this.lastStatusMs > 0 ? (nowMs - this.lastStatusMs) / 1000 : 0;
    const decayDb = 30 * dt;
    for (let i = 0; i < NUM_CHANNELS; i++) {
      const v = raw[i] ?? 0;
      this.peaks[i] = v;
      const peakDb = v > 0 ? 20 * Math.log10(v) : -90;
      const decayed = this.peakHoldDb[i] - decayDb;
      let hold = peakDb > decayed ? peakDb : decayed;
      if (hold < -90) hold = -90;
      this.peakHoldDb[i] = hold;
    }
    this.lastStatusMs = nowMs;
  }

  applyClipFlags(flags: number): void {
    for (let i = 0; i < NUM_CHANNELS; i++) {
      if ((flags & (1 << i)) !== 0) this.clipLatched[i] = true;
    }
  }

  // Fold a partial readout in: non-null fields update; null fields keep their
  // previous value, so a field that failed this cycle doesn't erase a value read
  // earlier (first-cycle null renders as '--').
  applyPartialInfo(p: PartialSystemInfo): void {
    if (this.info === null) {
      this.info = { ...p };
    } else {
      const next = { ...this.info };
      for (const k of Object.keys(p) as (keyof PartialSystemInfo)[]) {
        const v = p[k];
        if (v !== null) next[k] = v;
      }
      this.info = next;
    }
    this.lastInfoMs = performance.now();
  }
}
