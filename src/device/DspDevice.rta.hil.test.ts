import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DspDevice } from './DspDevice';
import * as Domain from '@/domain';
import { openSingleDevice } from '@test/hil/setup';

// Onboard RTA (fw V30+, vendor requests 0x08-0x0F). Band reads auto-start the
// analyser and it idles out 5 s after the last one, so these tests never send
// STOP and restore the config they found.

const IDLE_TIMEOUT_MS = 5000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// The firmware applies a staged config from its main loop, so the read-back
// can trail the SET briefly.
async function readBackConfig(device: DspDevice, expected: Domain.RtaConfig): Promise<Domain.RtaConfig> {
  let cfg = await device.getRtaConfig();
  for (let i = 0; i < 20 && JSON.stringify(cfg) !== JSON.stringify(expected); i++) {
    await sleep(50);
    cfg = await device.getRtaConfig();
  }
  return cfg;
}

describe('DspDevice — onboard RTA (HIL, V30+)', () => {
  let device: DspDevice;
  let close: () => Promise<void>;
  let supported = false;
  let caps: Domain.RtaCaps;
  let saved: Domain.RtaConfig;

  beforeAll(async () => {
    const opened = await openSingleDevice();
    device = opened.device;
    close = opened.close;
    if (!device.info.capabilities.features.rta) return;
    try {
      caps = await device.getRtaCaps();
    } catch {
      return;   // STALL: firmware without the module
    }
    supported = caps.version === Domain.RTA_CONFIG_VERSION;
    if (supported) saved = await device.getRtaConfig();
  });

  afterAll(async () => {
    if (supported && saved) await device.setRtaConfig(saved).catch(() => undefined);
    if (close) await close();
  });

  const ours = () => Domain.rtaWantedConfig(caps, device.hardware.outputCount);

  it('decodes caps sanely', (ctx) => {
    if (!supported) ctx.skip();
    expect(caps.version).toBe(3);
    expect(caps.maxBands).toBe(37);
    expect(caps.levelZero).toBeGreaterThan(0);
    expect(caps.fftOrderMin).toBeLessThanOrEqual(caps.fftOrderDefault);
    expect(caps.fftOrderDefault).toBeLessThanOrEqual(caps.fftOrderMax);
    expect(caps.outputChannels).toBe(device.hardware.outputCount);
  });

  it('serves an ascending centre table from 10 Hz', async (ctx) => {
    if (!supported) ctx.skip();
    const centres = await device.getRtaCentres(caps.maxBands);
    expect(centres[0]).toBe(10);
    expect(centres.length).toBeGreaterThanOrEqual(34);
    expect(centres.every((f, i) => i === 0 || f > centres[i - 1])).toBe(true);
  });

  it('applies the output-tap config and reads it back; an invalid one is dropped', async (ctx) => {
    if (!supported) ctx.skip();
    const cfg = ours();
    await device.setRtaConfig(cfg);
    expect(await readBackConfig(device, cfg)).toEqual(cfg);
    // The data stage ACKs regardless; only the read-back shows the drop.
    await device.setRtaConfig({ ...cfg, channelMask: 0 }).catch(() => undefined);
    expect(await readBackConfig(device, cfg)).toEqual(cfg);
  });

  it('bands-all returns frames with advancing seq, and the analyser is running', async (ctx) => {
    if (!supported) ctx.skip();
    await device.setRtaConfig(ours());
    await device.getRtaBandsAll();   // auto-starts the analyser
    await sleep(300);
    const first = await device.getRtaBandsAll();
    await sleep(300);
    const second = await device.getRtaBandsAll();
    // Silence leaves frames unproduced (age null, seq 0): nothing to compare.
    if (!first.some((f) => f.ageMs !== null)) return;
    const prev = new Map(first.map((f) => [f.channel, f.seq]));
    expect(second.some((f) => prev.has(f.channel) && f.seq !== prev.get(f.channel))).toBe(true);
    expect((await device.getRtaStatus()).state).not.toBe(Domain.RtaState.Idle);
  });

  it('idles out about five seconds after the last band read', async (ctx) => {
    if (!supported) ctx.skip();
    await device.setRtaConfig(ours());
    await device.getRtaBandsAll();
    await sleep(IDLE_TIMEOUT_MS + 500);
    expect((await device.getRtaStatus()).state).toBe(Domain.RtaState.Idle);
  }, 15_000);
});
