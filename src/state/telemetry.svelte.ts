import { type BufferStats, type PartialSystemInfo, Wire } from '@/protocol';
const { NUM_CHANNELS } = Wire.Const;

// Canonical Svelte 5 reactive store: each $state class field gets its own
// signal source, so reads from any module bind to the right subscribers
// regardless of update frequency. The plain `$state(object)` pattern works
// for data updated once at sync time but has been observed to miss
// subscribers when properties are mutated 20x/sec from RAF callbacks.
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
  info = $state<PartialSystemInfo | null>(null);
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
    this.info = null;
    this.lastStatusMs = 0;
    this.lastBufferMs = 0;
    this.lastInfoMs = 0;
    this.lastParamMs = 0;
    this.errorCount = 0;
  }

  // Apply peak normalization (0..1) with 30 dB/sec decay. Per-index writes.
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

  // Fold a partial readout into the store: non-null fields update; null
  // fields keep their previous value (or stay null on first cycle, which
  // renders as '--'). This is why `info` is PartialSystemInfo -- once any
  // field has been read successfully it stays a number; siblings that
  // fail this cycle don't erase what we've learned.
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

import { activeSession } from './appState.svelte';

// Inert fallback so component reads while disconnected get zeroed defaults. A
// stale in-flight poll write can land here after disconnect; harmless, since it
// is never read while a session is active and the next connect gets a fresh store.
const detached = new StatusStore();

function tele(): StatusStore {
  return activeSession()?.telemetry ?? detached;
}

// Transparent forwarder over the active session's telemetry. Transitional
// scaffolding: poll.ts and the reading components keep using the `status` global
// unchanged; they migrate to session.telemetry directly in a later phase, after
// which this bag is deleted. Only the fields/methods actually accessed are forwarded.
export const status = {
  get peaks() { return tele().peaks; },
  get peakHoldDb() { return tele().peakHoldDb; },
  get clipLatched() { return tele().clipLatched; },
  get info() { return tele().info; },
  get lastStatusMs() { return tele().lastStatusMs; },
  get cpu0() { return tele().cpu0; }, set cpu0(v: number) { tele().cpu0 = v; },
  get cpu1() { return tele().cpu1; }, set cpu1(v: number) { tele().cpu1 = v; },
  get streaming() { return tele().streaming; }, set streaming(v: boolean) { tele().streaming = v; },
  get pdmActive() { return tele().pdmActive; }, set pdmActive(v: boolean) { tele().pdmActive = v; },
  get sequence() { return tele().sequence; }, set sequence(v: number) { tele().sequence = v; },
  get bufferStats() { return tele().bufferStats; }, set bufferStats(v: BufferStats | null) { tele().bufferStats = v; },
  get errorCount() { return tele().errorCount; }, set errorCount(v: number) { tele().errorCount = v; },
  get lastBufferMs() { return tele().lastBufferMs; }, set lastBufferMs(v: number) { tele().lastBufferMs = v; },
  get lastInfoMs() { return tele().lastInfoMs; }, set lastInfoMs(v: number) { tele().lastInfoMs = v; },
  get lastParamMs() { return tele().lastParamMs; }, set lastParamMs(v: number) { tele().lastParamMs = v; },
  applyPeaks(raw: ArrayLike<number>, nowMs: number) { tele().applyPeaks(raw, nowMs); },
  applyClipFlags(flags: number) { tele().applyClipFlags(flags); },
  applyPartialInfo(p: PartialSystemInfo) { tele().applyPartialInfo(p); },
  reset() { tele().reset(); },
};

export function resetStatus(): void { status.reset(); }
export function applyPeaks(raw: ArrayLike<number>, nowMs: number): void { status.applyPeaks(raw, nowMs); }
export function applyClipFlags(flags: number): void { status.applyClipFlags(flags); }
