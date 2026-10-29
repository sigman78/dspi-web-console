import { describe, it, expect } from 'vitest';
import { MockTransport } from '@/transport/MockTransport';
import type { DspTransport } from '@/transport/DspTransport';
import { DspDevice } from './DspDevice';
import * as Protocol from '@/protocol';
import * as Domain from '@/domain';

const FRAME = 82;
const RTA_BANDS_ALL = Protocol.WireCmd.RtaGetBandsAll.code;

async function mockDevice(opts: ConstructorParameters<typeof MockTransport>[0] = { platform: 'rp2350', wireVersion: 31 }) {
  const t = new MockTransport(opts);
  return { t, d: await DspDevice.create(t) };
}

// Wraps a transport, replacing the bands-all answer.
function withBandsAll(base: MockTransport, answer: (real: Uint8Array) => Uint8Array): DspTransport {
  return {
    open: () => base.open(), close: () => base.close(), isOpen: () => base.isOpen(), on: (e, l) => base.on(e, l),
    ctrlIn: async (req, val, len) => {
      const real = await base.ctrlIn(req, val, len);
      return req === RTA_BANDS_ALL ? answer(real) : real;
    },
    ctrlOut: (req, val, data) => base.ctrlOut(req, val, data),
  };
}

describe('DspDevice — onboard RTA reader', () => {
  it('reads caps and a centre table that starts at 10 Hz and ascends', async () => {
    const { d } = await mockDevice();
    const caps = await d.getRtaCaps();
    const centres = await d.getRtaCentres(caps.maxBands);
    expect(centres).toHaveLength(caps.maxBands);
    expect(centres[0]).toBe(10);
    expect(centres.every((f, i) => i === 0 || f > centres[i - 1])).toBe(true);
  });

  it('stops reading centres at maxBands even when more are served', async () => {
    const { d } = await mockDevice();
    expect(await d.getRtaCentres(5)).toEqual([10, 13, 16, 20, 25]);
  });

  it('round-trips a valid config and silently drops an invalid one', async () => {
    const { d } = await mockDevice();
    const cfg = { tap: Domain.RtaTap.Output, channelMask: 0b11, fftOrder: 9, avgMs: 250, peakDecayDbS: 6, flags: 0 };
    await d.setRtaConfig(cfg);
    expect(await d.getRtaConfig()).toEqual(cfg);
    await d.setRtaConfig({ ...cfg, channelMask: 0 });
    await d.setRtaConfig({ ...cfg, fftOrder: 99 });
    expect(await d.getRtaConfig()).toEqual(cfg);
  });

  it('returns one frame per live output, placed by its own channel byte', async () => {
    const { d } = await mockDevice();
    const caps = await d.getRtaCaps();
    await d.setRtaConfig({ ...Domain.rtaWantedConfig(caps, d.hardware.outputCount), channelMask: 0b101 });
    const frames = await d.getRtaBandsAll();
    expect(frames.map((f) => f.channel)).toEqual([0, 2]);
    expect(frames[0].avg).toHaveLength(34);
    expect(frames[0].ageMs).not.toBeNull();
  });

  it('answers an empty list when no channel is live', async () => {
    const { t } = await mockDevice();
    const d = await DspDevice.create(withBandsAll(t, () => new Uint8Array(0)));
    expect(await d.getRtaBandsAll()).toEqual([]);
  });

  it('ignores a trailing partial frame', async () => {
    const { t } = await mockDevice();
    const d = await DspDevice.create(withBandsAll(t, (real) => real.subarray(0, FRAME * 2 + 40)));
    expect(await d.getRtaBandsAll()).toHaveLength(2);
  });

  it('reports never-produced frames as a null age', async () => {
    const { t } = await mockDevice();
    const d = await DspDevice.create(withBandsAll(t, (real) => {
      const out = real.slice(0, FRAME);
      out[4] = 0xFF; out[5] = 0xFF;
      return out;
    }));
    expect((await d.getRtaBandsAll())[0].ageMs).toBeNull();
  });

  it('STALLs the caps read on a wire without the module', async () => {
    const { d } = await mockDevice({ platform: 'rp2350', wireVersion: 29 });
    expect(d.capabilities.features.rta).toBe(false);
    await expect(d.getRtaCaps()).rejects.toThrow();
  });
});
