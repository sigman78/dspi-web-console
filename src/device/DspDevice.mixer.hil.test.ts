import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DspDevice } from './DspDevice';
import { openSingleDevice } from '@test/hil/setup';

// Float roundtrip tolerance: f32 precision through encode -> wire -> decode.
const F32_TOL = 4;

describe('DspDevice — mixer matrix wire commands (HIL)', () => {
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

  it('crosspoint (IN2→OUT1): independent of IN1 — verifies wValue/payload addressing', async () => {
    // This catches a class of bugs where the input/output addressing in
    // SetMatrixRoute (whether via wValue packing or payload bytes) gets
    // confused: writing IN2->OUT1 must NOT touch IN1->OUT1.
    const otherInput = 0;
    const target = { enabled: true, invert: true, gainDb: -2.0 };

    const otherOriginal = await device.getMatrixRoute(otherInput, 0);
    const original = await device.getMatrixRoute(1, 0);

    try {
      await device.setMatrixRoute(1, 0, target);

      const written = await device.getMatrixRoute(1, 0);
      expect(written.enabled).toBe(true);
      expect(written.invert).toBe(true);
      expect(written.gainDb).toBeCloseTo(-2.0, F32_TOL);

      // The other input's crosspoint must be untouched.
      const otherAfter = await device.getMatrixRoute(otherInput, 0);
      expect(otherAfter.enabled).toBe(otherOriginal.enabled);
      expect(otherAfter.invert).toBe(otherOriginal.invert);
      expect(otherAfter.gainDb).toBeCloseTo(otherOriginal.gainDb, F32_TOL);
    } finally {
      await device.setMatrixRoute(1, 0, original);
    }
  });
});
