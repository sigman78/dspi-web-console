import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DspDeviceGranular } from './DspDeviceGranular';
import { hasFormatVersion, openSingleDevice, withSavedField } from '@test/hil/setup';
import { FilterType } from '@/domain';

// Float roundtrip tolerance: f32 precision through encode -> wire -> decode.
// 4 decimal places is comfortable; 5 starts catching float-rounding noise.
const F32_TOL = 4;

describe('DspDevice — write→read roundtrips and bulk cross-validation (HIL)', () => {
  let device: DspDeviceGranular;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const opened = await openSingleDevice();
    device = opened.device;
    close = opened.close;
  });

  afterAll(async () => {
    if (close) await close();
  });

  it('master volume: write→getMasterVolume + bulk.masterVolumeDb cross-check', async () => {
    const bulk0 = await device.getAllParams();
    if (!hasFormatVersion(bulk0, 6)) return;

    await withSavedField(
      () => device.getMasterVolume(),
      (db) => device.setMasterVolume(db),
      async () => {
        for (const target of [-30, -12.5, 0]) {
          await device.setMasterVolume(target);

          const direct = await device.getMasterVolume();
          expect(direct).toBeCloseTo(target, F32_TOL);

          const bulk = await device.getAllParams();
          expect(bulk.masterVolumeDb).not.toBeNull();
          expect(bulk.masterVolumeDb!).toBeCloseTo(target, F32_TOL);
        }
      },
    );
  });

  it('master preamp: write→getMasterPreamp + bulk.preampDb cross-check', async () => {
    await withSavedField(
      () => device.getMasterPreamp(),
      (db) => device.setMasterPreamp(db),
      async () => {
        for (const target of [-6, 3, 0]) {
          await device.setMasterPreamp(target);

          const direct = await device.getMasterPreamp();
          expect(direct).toBeCloseTo(target, F32_TOL);

          const bulk = await device.getAllParams();
          expect(bulk.preampDb).toBeCloseTo(target, F32_TOL);
        }
      },
    );
  });

  it('input preamp L/R: write→getInputPreamp + bulk.preampLDb/preampRDb cross-check', async () => {
    const bulk0 = await device.getAllParams();
    if (!hasFormatVersion(bulk0, 6)) return;

    for (const channel of [0, 1] as const) {
      await withSavedField(
        () => device.getInputPreamp(channel),
        (db) => device.setInputPreamp(channel, db),
        async () => {
          for (const target of [-2.5, 0, 1.5]) {
            await device.setInputPreamp(channel, target);

            const direct = await device.getInputPreamp(channel);
            expect(direct).toBeCloseTo(target, F32_TOL);

            const bulk = await device.getAllParams();
            const fromBulk = channel === 0 ? bulk.preampLDb : bulk.preampRDb;
            expect(fromBulk).not.toBeNull();
            expect(fromBulk!).toBeCloseTo(target, F32_TOL);
          }
        },
      );
    }
  });

  it('EQ filter (channel 0, band 0): write→bulk.filters[0][0] roundtrip', async () => {
    // Save the original filter from the bulk packet, write a known one,
    // read back via bulk, then restore via setFilter.
    const bulk0 = await device.getAllParams();
    const original = { ...bulk0.filters[0][0] };

    try {
      const target = {
        type: FilterType.Peaking,
        frequency: 1000,
        q: 1,
        gain: 3,
      };
      await device.setFilter(0, 0, target);

      // Brief settle window: firmware may apply async; bulk re-reads should
      // see the new value on the next request, but a 20 ms cushion costs
      // nothing and avoids races on slower MCUs.
      await new Promise((r) => setTimeout(r, 20));

      const bulk = await device.getAllParams();
      const got = bulk.filters[0][0];
      expect(got.type).toBe(target.type);
      expect(got.frequency).toBeCloseTo(target.frequency, 1);
      expect(got.q).toBeCloseTo(target.q, F32_TOL);
      expect(got.gain).toBeCloseTo(target.gain, F32_TOL);
    } finally {
      await device.setFilter(0, 0, original);
    }
  });

  it('getFilter (multi-read) cross-checks against getAllParams + setFilter', async () => {
    const bulk0 = await device.getAllParams();
    const original = { ...bulk0.filters[0][0] };

    try {
      const target = {
        type: FilterType.Peaking,
        frequency: 1000,
        q: 1,
        gain: 3,
      };
      await device.setFilter(0, 0, target);

      // Brief settle window — match the existing setFilter test.
      await new Promise((r) => setTimeout(r, 20));

      // Multi-read API
      const direct = await device.getFilter(0, 0);
      expect(direct.type).toBe(target.type);
      expect(direct.frequency).toBeCloseTo(target.frequency, 1);
      expect(direct.q).toBeCloseTo(target.q, F32_TOL);
      expect(direct.gain).toBeCloseTo(target.gain, F32_TOL);

      // Cross-check against bulk
      const bulk = await device.getAllParams();
      const fromBulk = bulk.filters[0][0];
      expect(fromBulk.type).toBe(direct.type);
      expect(fromBulk.frequency).toBeCloseTo(direct.frequency, 1);
      expect(fromBulk.q).toBeCloseTo(direct.q, F32_TOL);
      expect(fromBulk.gain).toBeCloseTo(direct.gain, F32_TOL);
    } finally {
      await device.setFilter(0, 0, original);
    }
  });

  it('saveMasterVolume persists live volume → getSavedMasterVolume reads it back', async () => {
    const bulk0 = await device.getAllParams();
    if (!hasFormatVersion(bulk0, 6)) return;

    // Save the directory's existing saved volume so we can restore it.
    // Restore protocol: write live volume = original saved, then save.
    const originalSaved = await device.getSavedMasterVolume();
    const originalLive = await device.getMasterVolume();

    try {
      await device.setMasterVolume(-15);
      expect(await device.saveMasterVolume()).toBe(true);
      // Brief settle: flash erase/write may extend past the USB ACK on some
      // firmware builds. 100 ms is well above the ~45 ms worst-case noted in
      // docs/superpowers/specs/2026-05-09-missing-wire-cmds-design.md (Risks);
      // reliable in practice for the firmware revisions we test against.
      await new Promise((r) => setTimeout(r, 100));

      const saved = await device.getSavedMasterVolume();
      expect(saved).toBeCloseTo(-15, F32_TOL);
    } finally {
      // Restore: bring live + saved back to their original values.
      await device.setMasterVolume(originalSaved);
      await device.saveMasterVolume();
      // Same settle for the restore save (see comment above).
      await new Promise((r) => setTimeout(r, 100));
      await device.setMasterVolume(originalLive);
    }
  });
});
