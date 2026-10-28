import type { BufferStats, PartialSystemInfo } from '@/protocol';
import { ALL_CHANNELS, type SpdifRxStatus, type I2sSlaveStatus, type AdatOutputStatus, type AdatInputStatus, type LimiterStatus } from '@/domain';

// Peaks/holds/clips are DOMAIN-ChannelId indexed (the poll loop remaps from
// the device's wire index space); sized to the full domain id range.
const NUM_CHANNELS = ALL_CHANNELS.length;

// Per-field $state (not $state(object)): each field gets its own signal source.
// The object form was observed to miss subscribers when properties are mutated
// 20x/sec from RAF callbacks.
export class StatusStore {
  peaks = $state<number[]>(Array(NUM_CHANNELS).fill(0));
  clipLatched = $state<boolean[]>(Array(NUM_CHANNELS).fill(false));
  cpu0 = $state(0);
  cpu1 = $state(0);
  streaming = $state(false);
  pdmActive = $state(false);
  sequence = $state(0);
  bufferStats = $state<BufferStats | null>(null);
  spdifRxStatus = $state<SpdifRxStatus | null>(null);
  i2sSlaveStatus = $state<I2sSlaveStatus | null>(null);
  adatStatus = $state<AdatOutputStatus | null>(null);
  adatInputStatus = $state<AdatInputStatus | null>(null);
  // PR.06 headroom readout (fw V29+); 0 while subharm is disabled, null before
  // the first read.
  subharmHeadroomDb = $state<number | null>(null);
  info = $state<PartialSystemInfo | null>(null);
  // Live active input channel count (null = not reported yet).
  activeInputChannels = $state<number | null>(null);
  lastStatusMs = $state(0);
  lastBufferMs = $state(0);
  lastInfoMs = $state(0);
  lastParamMs = $state(0);
  // PR.06 headroom cadence clock, on the store (not poll-loop-local) so a
  // scrub commit can force a re-read via requestSubharmRead() below.
  lastSubharmMs = $state(0);
  errorCount = $state(0);

  // Forces the next poll tick to re-read subharm headroom; called from every
  // setSubharm* verb (processingActions.ts) instead of assigning lastSubharmMs directly.
  requestSubharmRead(): void { this.lastSubharmMs = 0; }

  // PR.06 runtime-only solo monitor mirror (fw V30+ GET 0x2D); never part of
  // the snapshot/presets/dirty tracking.
  subharmSolo = $state(false);
  // PR.06 live per-output sub meter (fw V30+ GET 0x1F), 0..1 per wire output;
  // null when not polled / subharm disabled.
  subharmMeter = $state<number[] | null>(null);
  subharmMeterWanted = $state(0);
  lastSubharmMeterMs = $state(0);

  // Panel-mount interest for the subharm meter cadence (poll.ts): the panel
  // holds interest while mounted; the returned release decrements it and, once
  // interest reaches 0, nulls the meter so a stale reading doesn't linger.
  wantSubharmMeter(): () => void {
    this.subharmMeterWanted++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.subharmMeterWanted--;
      if (this.subharmMeterWanted <= 0) this.subharmMeter = null;
    };
  }

  // PR.07 live limiter telemetry (fw V32+ REQ_LIMITER 0x81): gain reduction in
  // dB per wire output (0 = none) and the lookahead status block. Both null
  // when not polled.
  limiterMeterDb = $state<number[] | null>(null);
  limiterStatus = $state<LimiterStatus | null>(null);
  limiterMeterWanted = $state(0);
  lastLimiterMeterMs = $state(0);
  lastLimiterStatusMs = $state(0);

  // Panel-mount interest for the limiter cadence (poll.ts), same contract as
  // wantSubharmMeter: the release nulls the readings once interest hits 0.
  wantLimiterMeter(): () => void {
    this.limiterMeterWanted++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.limiterMeterWanted--;
      if (this.limiterMeterWanted <= 0) {
        this.limiterMeterDb = null;
        this.limiterStatus = null;
      }
    };
  }

  bufferStatsWanted = $state(0);

  // Panel-mount interest for the buffer-stats cadence (poll.ts): the 4 Hz fetch
  // runs only while a diagnostics panel is mounted.
  wantBufferStats(): () => void {
    this.bufferStatsWanted++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.bufferStatsWanted--;
    };
  }

  // Ask the next limiter poll tick to re-read the status block after an enable
  // change. Firmware engages the lookahead after a fade, so this may still read
  // the old state; the next 1 Hz refresh catches it.
  requestLimiterStatusRead(): void { this.lastLimiterStatusMs = 0; }

  // Peak levels (0..1).
  applyPeaks(raw: ArrayLike<number>, nowMs: number): void {
    for (let i = 0; i < NUM_CHANNELS; i++) this.peaks[i] = raw[i] ?? 0;
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
