import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DspDevice } from '@/device/DspDevice';
import { openSingleDevice } from '@test/hil/setup';

// Drives the *shape* of the production poll loop (status + buffer stats
// intermixed) against real hardware without bringing in the actual
// poll.ts module. Catches firmware regressions where status reads
// silently return stale data, the sequence counter freezes, or a
// buffer-stats race exposes a bad packet.
//
// Wider iteration counts and wall-clock loops were trimmed in favor of
// one mixed-read pass; the per-call shape assertions in
// DspDevice.hil.test.ts already cover repeated single-stream reads.

const STATUS_INTERVAL_MS = 50;
const BUFFER_INTERVAL_MS = 250;
const RUN_DURATION_MS = 1500;

describe('poll loop — mixed status + buffer-stats reads (HIL)', () => {
  let device: DspDevice;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const opened = await openSingleDevice();
    device = opened.device;
    close = opened.close;
  });

  afterAll(async () => {
    if (close) await close();
  });

  it('intermixed transfers stay bounded and the buffer sequence advances', async () => {
    const numCh = device.hardware.totalChannelCount;
    const sequences: number[] = [];

    let lastStatus = 0;
    let lastBuffer = 0;
    const start = Date.now();

    while (Date.now() - start < RUN_DURATION_MS) {
      const now = Date.now();
      if (now - lastStatus >= STATUS_INTERVAL_MS) {
        const s = await device.getSystemStatus();
        for (let ch = 0; ch < numCh; ch++) {
          expect(s.peaks[ch]).toBeGreaterThanOrEqual(0);
          expect(s.peaks[ch]).toBeLessThanOrEqual(1);
        }
        expect(s.cpu0).toBeGreaterThanOrEqual(0);
        expect(s.cpu0).toBeLessThanOrEqual(100);
        lastStatus = now;
      }
      if (now - lastBuffer >= BUFFER_INTERVAL_MS) {
        const b = await device.getBufferStats();
        expect(b).not.toBeNull();
        if (b) sequences.push(b.sequence);
        lastBuffer = now;
      }
      await new Promise((r) => setTimeout(r, 10));
    }

    expect(sequences.length).toBeGreaterThan(1);
    const moved = sequences.some((s) => s !== sequences[0]);
    expect(moved).toBe(true);
  });
});
