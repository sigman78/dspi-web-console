import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DspDevice } from './DspDevice';
import { openSingleDevice } from '../../hil/setup';
import { PlatformType } from '@/domain';

describe('DspDevice — read-side smoke (HIL)', () => {
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
    expect(info.firmwareVersion.length).toBeGreaterThan(0);
    expect(info.firmwareVersion).toBe(info.firmwareVersion.trim());
    expect(info.firmwareVersion).not.toContain('\0');
  });

  it('info getter is stable', async () => {
    const a = device.info;
    const b = device.info;
    expect(b.platformType).toBe(a.platformType);
    expect(b.firmwareVersion).toBe(a.firmwareVersion);
  });

  it('getSystemStatus returns plausible peaks/cpu/clip values', async () => {
    const numCh = device.hardware.totalChannelCount;

    const s = await device.getSystemStatus();
    expect(s.peaks.length).toBe(11); // host status array is fixed-width; request size is platform-specific

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

  it('getBufferStats sequence advances over a short window', async () => {
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const b = await device.getBufferStats();
      if (b) samples.push(b.sequence);
      await new Promise((r) => setTimeout(r, 60));
    }
    expect(samples.length).toBeGreaterThan(0);
    // Detect movement. If firmware is stuck, all samples are equal.
    const moved = samples.some((s) => s !== samples[0]);
    expect(moved).toBe(true);
  });
});
