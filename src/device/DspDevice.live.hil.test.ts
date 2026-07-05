import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DspDevice } from './DspDevice';
import { openSingleDevice } from '@test/hil/setup';
import { PlatformType } from '@/domain';

// Drives the *shape* of the production poll loop (status + buffer stats
// intermixed) against real hardware without bringing in the actual
// poll.ts module. Catches firmware regressions where status reads
// silently return stale data, the sequence counter freezes, or a
// buffer-stats race exposes a bad packet.

const STATUS_INTERVAL_MS = 50;
const BUFFER_INTERVAL_MS = 250;
const RUN_DURATION_MS = 1500;

describe('DspDevice — liveness & smoke (HIL)', () => {
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

  it('factory captures a non-empty trimmed serial', async () => {
    const serial = device.info.serial;
    expect(typeof serial).toBe('string');
    expect(serial.length).toBeGreaterThan(0);
    expect(serial).toBe(serial.trim());
    expect(serial).not.toContain('\0');
  });

  it('factory captures a known platform type and non-empty firmware string', async () => {
    const info = device.info;
    expect([PlatformType.RP2040, PlatformType.RP2350]).toContain(info.platformType);
    expect(info.capabilities.fwLabel.length).toBeGreaterThan(0);
    expect(info.capabilities.fwLabel).toBe(info.capabilities.fwLabel.trim());
    expect(info.capabilities.fwLabel).not.toContain('\0');
  });

  it('info getter is stable', async () => {
    const a = device.info;
    const b = device.info;
    expect(b.platformType).toBe(a.platformType);
    expect(b.capabilities.fwLabel).toBe(a.capabilities.fwLabel);
  });

  it('getSystemStatus returns plausible peaks/cpu/clip values', async () => {
    const numCh = device.hardware.totalChannelCount;

    const s = await device.getSystemStatus();
    // parseSystemStatus always allocates a V16-max-width (17) peaks array,
    // zero-filled past the device's own channel count -- fixed regardless
    // of the connected generation.
    expect(s.peaks.length).toBe(17);

    for (let i = 0; i < numCh; i++) {
      expect(s.peaks[i]).toBeGreaterThanOrEqual(0);
      expect(s.peaks[i]).toBeLessThanOrEqual(1);
    }
    expect(s.cpu0).toBeGreaterThanOrEqual(0);
    expect(s.cpu0).toBeLessThanOrEqual(100);
    expect(s.cpu1).toBeGreaterThanOrEqual(0);
    expect(s.cpu1).toBeLessThanOrEqual(100);

    // No clip flags outside the valid channel range.
    const validMask = (1 << numCh) - 1;
    expect(s.clipFlags & ~validMask).toBe(0);
  });

  it('getBufferStats returns sane percent fields and a known SPDIF count', async () => {
    const b = await device.getBufferStats();
    expect(b).not.toBeNull();
    if (!b) return;

    expect([2, 4]).toContain(b.numSpdif);

    for (const s of b.spdif) {
      for (const pct of [s.consumerFillPct, s.consumerMinFillPct, s.consumerMaxFillPct]) {
        expect(pct).toBeGreaterThanOrEqual(0);
        expect(pct).toBeLessThanOrEqual(100);
      }
    }
    for (const pct of [
      b.pdm.dmaFillPct, b.pdm.dmaMinFillPct, b.pdm.dmaMaxFillPct,
      b.pdm.ringFillPct, b.pdm.ringMinFillPct, b.pdm.ringMaxFillPct,
    ]) {
      expect(pct).toBeGreaterThanOrEqual(0);
      expect(pct).toBeLessThanOrEqual(100);
    }
    expect(typeof b.streaming).toBe('boolean');
    expect(typeof b.pdmActive).toBe('boolean');
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
