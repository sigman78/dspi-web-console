import { session } from '../state/session.svelte';
import { applyClipFlags, applyPeaks, status } from '../state/telemetry.svelte';
import { warn } from '../utils/log';


const STATUS_INTERVAL_MS = 50;   // ~20 Hz -- peaks + cpu (REQ_GET_STATUS wValue=9)
const BUFFER_INTERVAL_MS = 250;  // ~4 Hz  -- buffer stats (0xB0)
const INFO_INTERVAL_MS = 1000;   // ~1 Hz  -- env scalars + counters (0x50 wValues 3..17)

let rafId: number | null = null;
let polling = false;
let inFlightStatus = false;
let inFlightBuffer = false;
let inFlightInfo = false;

export function startPolling(): void {
  stopPolling();
  polling = true;
  status.errorCount = 0;
  if (typeof requestAnimationFrame === 'undefined') return;
  const tick = () => {
    rafId = requestAnimationFrame(tick);
    void doPoll();
  };
  rafId = requestAnimationFrame(tick);
}

export function stopPolling(): void {
  if (rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
    cancelAnimationFrame(rafId);
  }
  rafId = null;
  polling = false;
  inFlightStatus = false;
  inFlightBuffer = false;
  inFlightInfo = false;
}

async function doPoll(): Promise<void> {
  if (!polling) return;
  const d = session.device;
  if (!d) return;
  const now = performance.now();

  if (!inFlightStatus && now - status.lastStatusMs >= STATUS_INTERVAL_MS) {
    inFlightStatus = true;
    try {
      const s = await d.getSystemStatus();
      applyPeaks(s.peaks, performance.now());
      applyClipFlags(s.clipFlags);
      status.cpu0 = s.cpu0;
      status.cpu1 = s.cpu1;
      status.errorCount = 0;
    } catch (e) {
      status.errorCount++;
      if (status.errorCount <= 3) warn('poll', 'getSystemStatus failed', e);
      // Don't push connection to 'error': a failing status poll on a
      // working device is itself diagnostic info, not a connection loss.
    } finally {
      inFlightStatus = false;
    }
  }

  if (
    !inFlightBuffer &&
    now - status.lastBufferMs >= BUFFER_INTERVAL_MS
  ) {
    inFlightBuffer = true;
    try {
      const b = await d.getBufferStats();
      if (b) {
        status.bufferStats = b;
        status.streaming = b.streaming;
        status.pdmActive = b.pdmActive;
        status.sequence = b.sequence;
      }
      status.lastBufferMs = performance.now();
    } catch (e) {
      // buffer stats are optional; do not flip connection to error here
      warn('poll', 'getBufferStats failed', e);
      status.lastBufferMs = performance.now();
    } finally {
      inFlightBuffer = false;
    }
  }

  if (
    !inFlightInfo &&
    now - status.lastInfoMs >= INFO_INTERVAL_MS
  ) {
    inFlightInfo = true;
    try {
      // applyPartialInfo handles the per-field-null fold and updates
      // lastInfoMs on success. The catch covers "the whole call rejected"
      // (e.g. transport timeout), distinct from "individual fields rejected"
      // which getSystemInfo now tolerates internally.
      status.applyPartialInfo(await d.getSystemInfo());
    } catch (e) {
      // System info is non-critical telemetry; mark the timestamp anyway so
      // we don't tight-loop retries against a misbehaving firmware.
      warn('poll', 'getSystemInfo failed', e);
      status.lastInfoMs = performance.now();
    } finally {
      inFlightInfo = false;
    }
  }
}
