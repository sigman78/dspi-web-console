// HIL coverage for the 1.1.4 wire surface (M1-M9): user volume/mute, per-band
// bypass, LG Sound Sync, DAC HW mute config, input source + S/PDIF RX reads,
// and buffer-stats reset. EnterBootloader (0xF0) is deliberately NOT covered:
// it reboots the device out of the test session.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DspDevice } from './DspDevice';
import { openSingleDevice, withSavedField } from '@test/hil/setup';
import { AudioInputSource, SpdifInputState, type ChannelId } from '@/domain';

const F32_TOL = 4;

// Input switches and DAC-config writes trigger deferred firmware work
// (pipeline reset, EMC mute); give the main loop a beat before re-reading.
const SETTLE_MS = 500;
const settle = () => new Promise((r) => setTimeout(r, SETTLE_MS));

describe('DspDevice — 1.1.4 surface roundtrips (HIL)', () => {
  let device: DspDevice;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const opened = await openSingleDevice();
    device = opened.device;
    close = opened.close;
    expect(opened.device.capabilities.wire).toBeGreaterThanOrEqual(10);
  });

  afterAll(async () => {
    if (close) await close();
  });

  it('user volume: write→getUserVolume + bulk.userVolume cross-check', async () => {
    await withSavedField(
      () => device.getUserVolume(),
      (db) => device.setUserVolume(db),
      async () => {
        for (const target of [-30, -12.5, 0]) {
          await device.setUserVolume(target);
          expect(await device.getUserVolume()).toBeCloseTo(target, F32_TOL);
          const bulk = await device.getAllParams();
          expect(bulk.userVolume.volumeDb).toBeCloseTo(target, F32_TOL);
        }
      },
    );
  });

  it('user mute: write→getUserMute + bulk.userVolume.mute cross-check', async () => {
    await withSavedField(
      () => device.getUserMute(),
      (m) => device.setUserMute(m),
      async () => {
        for (const target of [true, false]) {
          await device.setUserMute(target);
          expect(await device.getUserMute()).toBe(target);
          const bulk = await device.getAllParams();
          expect(bulk.userVolume.mute).toBe(target);
        }
      },
    );
  });

  it('per-band bypass: write→getBandBypass + bulk filter bypass byte cross-check', async () => {
    const channel = 0 as ChannelId;
    const band = 0;
    await withSavedField(
      () => device.getBandBypass(channel, band),
      (b) => device.setBandBypass(channel, band, b),
      async () => {
        for (const target of [true, false]) {
          await device.setBandBypass(channel, band, target);
          expect(await device.getBandBypass(channel, band)).toBe(target);
          const bulk = await device.getAllParams();
          expect(bulk.filters[0][band].bypass).toBe(target);
        }
      },
    );
  });

  it('LG Sound Sync: enable write→read + bulk cross-check; status read parses', async () => {
    await withSavedField(
      () => device.getLgSoundSyncEnabled(),
      (e) => device.setLgSoundSyncEnabled(e),
      async () => {
        for (const target of [true, false]) {
          await device.setLgSoundSyncEnabled(target);
          expect(await device.getLgSoundSyncEnabled()).toBe(target);
          const bulk = await device.getAllParams();
          expect(bulk.lgSoundSync.enabled).toBe(target);
        }
      },
    );
    const status = await device.getLgSoundSyncStatus();
    expect(typeof status.enabled).toBe('boolean');
    expect(typeof status.present).toBe('boolean');
    expect(status.volume).toBeGreaterThanOrEqual(0);
  });

  describe.skipIf(!process.env.HIL_INVASIVE)('invasive tests with audible/pipeline side effects', () => {
    it('DAC HW mute: disabled writes zero the config; enabled writes round-trip (pin NONE = no GPIO claimed)', async () => {
      // Firmware contract (dac_hw_mute.c): enabled=0 is always accepted and
      // zeroes the stored config; enabled=1 validates hold/release/pin in a
      // deferred handler that swallows failures (read back to learn the verdict).
      const PIN_NONE = 0xFF;
      await withSavedField(
        () => device.getDacHwMute(),
        async (cfg) => { await device.setDacHwMute(cfg); await settle(); },
        async () => {
          const saved = await device.getDacHwMute();

          if (saved.enabled) {
            // Configured bench: vary timings within the firmware's [1,500] range,
            // keep the wired pin.
            const target = { ...saved, holdMs: 25, releaseMs: 35 };
            await device.setDacHwMute(target);
            await settle();
            expect(await device.getDacHwMute()).toEqual(target);
            const bulk = await device.getAllParams();
            expect(bulk.dacHwMute).toEqual(target);
            return;
          }

          // Disabled write with non-zero fields -> accepted but zeroed.
          await device.setDacHwMute({ enabled: false, activeLow: true, pin: PIN_NONE, holdMs: 25, releaseMs: 35 });
          await settle();
          const zeroed = await device.getDacHwMute();
          expect(zeroed.enabled).toBe(false);
          expect(zeroed.holdMs).toBe(0);
          expect(zeroed.releaseMs).toBe(0);

          // Enabled write with pin NONE: validated + applied, no GPIO claimed.
          const target = { enabled: true, activeLow: true, pin: PIN_NONE, holdMs: 25, releaseMs: 35 };
          await device.setDacHwMute(target);
          await settle();
          expect(await device.getDacHwMute()).toEqual(target);
          const bulk = await device.getAllParams();
          expect(bulk.dacHwMute).toEqual(target);
        },
      );
    });

    it('input source: USB↔S/PDIF switch round-trips; RX status parses while on S/PDIF', async () => {
      await withSavedField(
        () => device.getInputSource(),
        async (src) => { await device.setInputSource(src); await settle(); },
        async () => {
          await device.setInputSource(AudioInputSource.Spdif);
          await settle();
          expect(await device.getInputSource()).toBe(AudioInputSource.Spdif);
          let bulk = await device.getAllParams();
          expect(bulk.inputConfig.source).toBe(AudioInputSource.Spdif);

          const rx = await device.getSpdifRxStatus();
          expect([
            SpdifInputState.Inactive, SpdifInputState.Acquiring,
            SpdifInputState.Locked, SpdifInputState.Relocking,
          ]).toContain(rx.state);
          expect(rx.fifoFillPct).toBeGreaterThanOrEqual(0);
          expect(rx.fifoFillPct).toBeLessThanOrEqual(100);

          const ch = await device.getSpdifRxChStatus();
          expect(ch.byteLength).toBe(24);

          await device.setInputSource(AudioInputSource.Usb);
          await settle();
          expect(await device.getInputSource()).toBe(AudioInputSource.Usb);
          bulk = await device.getAllParams();
          expect(bulk.inputConfig.source).toBe(AudioInputSource.Usb);
        },
      );
    });
  });

  it('S/PDIF RX pin: get matches bulk; no-op set of the current pin is accepted', async () => {
    const pin = await device.getSpdifRxPin();
    const bulk = await device.getAllParams();
    expect(bulk.inputConfig.spdifRxPin).toBe(pin);
    const r = await device.setSpdifRxPin(pin);
    expect(r.ok).toBe(true);
  });

  it('buffer stats: reset acks and the next packet parses', async () => {
    expect(await device.resetBufferStats()).toBe(true);
    const stats = await device.getBufferStats();
    expect(stats).not.toBeNull();
    expect(stats!.numSpdif).toBeGreaterThanOrEqual(0);
  });
});
