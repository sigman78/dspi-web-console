import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DspDevice } from './DspDevice';
import { openSingleDevice, withSavedField } from '../../hil/setup';

// Float roundtrip tolerance: f32 precision through encode -> wire -> decode.
const F32_TOL = 4;

// Pick a non-PDM output for per-output writes so PDM/SPDIF exclusivity
// rules (docs/mixer.md) don't bite us. Output 0 is always available
// (S/PDIF 1 L) on both RP2040 and RP2350.
const SAFE_OUTPUT = 0;

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

  // --- Per-output flags --------------------------------------------------

  it('output enable: write→getOutputEnable + bulk.outputs[i].enabled cross-check', async () => {
    await withSavedField(
      () => device.getOutputEnable(SAFE_OUTPUT),
      (on) => device.setOutputEnable(SAFE_OUTPUT, on),
      async () => {
        for (const target of [false, true, false]) {
          await device.setOutputEnable(SAFE_OUTPUT, target);

          expect(await device.getOutputEnable(SAFE_OUTPUT)).toBe(target);

          const bulk = await device.getAllParams();
          expect(bulk.outputs[SAFE_OUTPUT].enabled).toBe(target);
        }
      },
    );
  });

  it('output mute: write→getOutputMute + bulk.outputs[i].muted cross-check', async () => {
    await withSavedField(
      () => device.getOutputMute(SAFE_OUTPUT),
      (m) => device.setOutputMute(SAFE_OUTPUT, m),
      async () => {
        for (const target of [true, false, true]) {
          await device.setOutputMute(SAFE_OUTPUT, target);

          expect(await device.getOutputMute(SAFE_OUTPUT)).toBe(target);

          const bulk = await device.getAllParams();
          expect(bulk.outputs[SAFE_OUTPUT].muted).toBe(target);
        }
      },
    );
  });

  // --- Per-output numeric ------------------------------------------------

  it('output gain: write→getOutputGain + bulk.outputs[i].gainDb cross-check', async () => {
    await withSavedField(
      () => device.getOutputGain(SAFE_OUTPUT),
      (db) => device.setOutputGain(SAFE_OUTPUT, db),
      async () => {
        for (const target of [-12, -3.5, 0, 6]) {
          await device.setOutputGain(SAFE_OUTPUT, target);

          expect(await device.getOutputGain(SAFE_OUTPUT)).toBeCloseTo(target, F32_TOL);

          const bulk = await device.getAllParams();
          expect(bulk.outputs[SAFE_OUTPUT].gainDb).toBeCloseTo(target, F32_TOL);
        }
      },
    );
  });

  it('output delay: write→getOutputDelay + bulk.outputs[i].delayMs cross-check', async () => {
    await withSavedField(
      () => device.getOutputDelay(SAFE_OUTPUT),
      (ms) => device.setOutputDelay(SAFE_OUTPUT, ms),
      async () => {
        for (const target of [0, 1.5, 12.7, 50]) {
          await device.setOutputDelay(SAFE_OUTPUT, target);

          expect(await device.getOutputDelay(SAFE_OUTPUT)).toBeCloseTo(target, F32_TOL);

          const bulk = await device.getAllParams();
          expect(bulk.outputs[SAFE_OUTPUT].delayMs).toBeCloseTo(target, F32_TOL);
        }
      },
    );
  });

  // --- Crosspoint -------------------------------------------------------
  //
  // SetMatrixRoute bundles {enabled, invert, gainDb} into one packet, so
  // restoration must save and replay the whole tuple. We can't use
  // withSavedField directly (it's single-field). Snapshot manually.

  it('crosspoint (IN1→OUT1): write→getMatrixRoute + bulk.crosspoints[0][0] cross-check', async () => {
    const input = 0;
    const output = 0;
    const original = await device.getMatrixRoute(input, output);

    try {
      // Three target tuples to verify all fields round-trip independently.
      const targets = [
        { enabled: true,  invert: false, gainDb:  0   },
        { enabled: true,  invert: true,  gainDb: -6.0 },
        { enabled: false, invert: false, gainDb:  3.5 },
      ];

      for (const target of targets) {
        await device.setMatrixRoute(input, output, target);

        const direct = await device.getMatrixRoute(input, output);
        expect(direct.enabled).toBe(target.enabled);
        expect(direct.invert).toBe(target.invert);
        expect(direct.gainDb).toBeCloseTo(target.gainDb, F32_TOL);

        const bulk = await device.getAllParams();
        const cp = bulk.crosspoints[input][output];
        expect(cp.enabled).toBe(target.enabled);
        expect(cp.invert).toBe(target.invert);
        expect(cp.gainDb).toBeCloseTo(target.gainDb, F32_TOL);
      }
    } finally {
      await device.setMatrixRoute(input, output, original);
    }
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
