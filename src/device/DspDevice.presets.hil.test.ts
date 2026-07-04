// HIL coverage for the preset surface (0x90–0x9A) plus the legacy
// SaveParams/FactoryReset persistence commands. Uses slots 8 and 9 by
// convention so tests don't stomp on user presets in slots 0–7.
//
// Run via `npm run test:hil` against connected hardware. Does NOT run
// under `npm test`.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DspDevice } from './DspDevice';
import { openSingleDevice, withSavedField } from '@test/hil/setup';
import { PresetStartupMode } from '@/protocol';
import { OutputConfigMode } from '@/domain';

const TEST_SLOT_A = 8;
const TEST_SLOT_B = 9;

// Firmware defers Save/Load/Delete flash work to its main loop. Pacing
// guards against reading back stale directory state while the deferred
// write is still in flight.
const FLASH_SETTLE_MS = 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!process.env.HIL_DESTRUCTIVE)('DspDevice — presets (HIL)', () => {
  let device: DspDevice;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const opened = await openSingleDevice();
    device = opened.device;
    close = opened.close;
  });

  afterAll(async () => {
    // Best-effort cleanup so we don't leave garbage in slots 8/9.
    try { await device.deletePreset(TEST_SLOT_A); } catch { /* ignore */ }
    try { await device.deletePreset(TEST_SLOT_B); } catch { /* ignore */ }
    if (close) await close();
  });

  it('reads the preset directory', async () => {
    const dir = await device.getPresetDirectory();
    // Per firmware preset.h: only Specified (0) and LastActive (1) are
    // defined. Anything else is a firmware divergence we want to catch.
    expect([PresetStartupMode.Specified, PresetStartupMode.LastActive])
      .toContain(dir.startupMode);
    expect(Object.values(OutputConfigMode)).toContain(dir.outputConfigMode);
  });

  it('reads the active preset slot', async () => {
    const slot = await device.getActivePreset();
    // Per firmware spec PresetGetActive (0x9A) returns 0..9 or null
    // (transient firmware state); UI layer coerces null → 0 for display.
    expect(slot === null || (typeof slot === 'number' && slot >= 0 && slot < 10)).toBe(true);
  });

  it('roundtrips name set/get on a test slot', async () => {
    await device.setPresetName(TEST_SLOT_A, 'HIL-Test-A');
    expect(await device.getPresetName(TEST_SLOT_A)).toBe('HIL-Test-A');
  });

  it('roundtrips a save/load on a test slot', async () => {
    const save = await device.savePreset(TEST_SLOT_A);
    expect(save.ok).toBe(true);
    await sleep(FLASH_SETTLE_MS);

    const load = await device.loadPreset(TEST_SLOT_A);
    expect(load.ok).toBe(true);
    await sleep(FLASH_SETTLE_MS);
  });

  it('preset save/load round-trips the user-volume axis (integer-quantized)', async () => {
    // Bench-verified 2026-07-03 on fw 1.1.4: save captures the live user
    // volume into the preset and load applies it back, quantized to whole
    // dB (-7.5 saves/loads as -8; -3 comes back exactly). The live axis
    // itself holds fractional dB fine -- the quantization is in the
    // preset image.
    await withSavedField(
      () => device.getUserVolume(),
      (db) => device.setUserVolume(db),
      async () => {
        await device.setUserVolume(-7.5);
        const save = await device.savePreset(TEST_SLOT_A);
        expect(save.ok).toBe(true);
        await sleep(FLASH_SETTLE_MS);

        await device.setUserVolume(-20);
        const load = await device.loadPreset(TEST_SLOT_A);
        expect(load.ok).toBe(true);
        await sleep(FLASH_SETTLE_MS);

        expect(await device.getUserVolume()).toBeCloseTo(-8, 3);
      },
    );
  });

  it('load on empty slot succeeds (firmware applies factory defaults)', async () => {
    // Make sure slot B is empty.
    await device.deletePreset(TEST_SLOT_B);
    await sleep(FLASH_SETTLE_MS);

    // Per user_presets_spec.md: PRESET_ERR_SLOT_EMPTY is reserved; load
    // on an empty slot now succeeds with factory defaults applied.
    const r = await device.loadPreset(TEST_SLOT_B);
    expect(r.ok).toBe(true);
  });

  // DESTRUCTIVE: clears slots 0-9, not just 8/9. Disabled by default to
  // protect real user presets on dev hardware. Uncomment to verify the
  // `clearAllPresets` helper against firmware — only on a device where
  // losing slots 0-7 is acceptable.
  // it('clearAllPresets on test slots leaves them empty', async () => {
  //   // Save into both test slots so there's something to clear.
  //   await device.savePreset(TEST_SLOT_A);
  //   await sleep(FLASH_SETTLE_MS);
  //   await device.savePreset(TEST_SLOT_B);
  //   await sleep(FLASH_SETTLE_MS);
  //
  //   const r = await device.clearAllPresets();
  //   expect(r.ok).toBe(true);
  //
  //   const dir = await device.getPresetDirectory();
  //   expect(dir.occupiedMask).toBe(0);
  // });
});
