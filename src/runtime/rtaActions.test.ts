import { describe, it, expect, afterEach } from 'vitest';
import * as Domain from '@/domain';
import { MockTransport } from '@/transport/MockTransport';
import type { DspTransport } from '@/transport/DspTransport';
import { WireCmd } from '@/protocol';
import { DspDevice } from '@/device/DspDevice';
import { dispatch, mintConnId, makeReadySession, resetAppState } from '@/state';
import { TimeoutError } from '@/transport/withTimeout';
import { setupRta, readRtaFrames } from './rtaActions';

afterEach(() => { resetAppState(); });

async function rig(
  opts: ConstructorParameters<typeof MockTransport>[0] = { platform: 'rp2350', wireVersion: 31 },
  tweak: (req: number, real: Uint8Array) => Uint8Array = (_r, real) => real,
) {
  const mock = new MockTransport(opts);
  const sets: Uint8Array[] = [];
  const spy: DspTransport = {
    open: () => mock.open(), close: () => mock.close(), isOpen: () => mock.isOpen(), on: (e, l) => mock.on(e, l),
    ctrlIn: async (req, val, len) => tweak(req, await mock.ctrlIn(req, val, len)),
    ctrlOut: (req, val, data) => {
      if (req === WireCmd.RtaSetConfig.code) sets.push(data);
      return mock.ctrlOut(req, val, data);
    },
  };
  const device = await DspDevice.create(spy);
  const session = makeReadySession(device);
  dispatch({ t: 'synced', id: mintConnId(), session });
  return { device, session, sets };
}

describe('setupRta', () => {
  it('adopts a device config that already covers every output, and caches caps and centres', async () => {
    const { device, session, sets } = await rig();
    expect(await setupRta(session, device)).toBe(true);
    expect(sets).toHaveLength(0);
    expect(session.telemetry.rtaAvailability).toBe('available');
    expect(session.telemetry.rtaCentres[0]).toBe(10);
  });

  it('pushes a widened config when the device mask is narrower', async () => {
    const { device, session, sets } = await rig();
    await device.setRtaConfig({ tap: Domain.RtaTap.Output, channelMask: 0b1, fftOrder: 9, avgMs: 0, peakDecayDbS: 0, flags: 0 });
    expect(await setupRta(session, device)).toBe(true);
    expect(session.telemetry.rtaConfig?.channelMask).toBe((1 << device.hardware.outputCount) - 1);
    expect(session.telemetry.rtaConfig?.fftOrder).toBe(session.telemetry.rtaCaps?.fftOrderDefault);
    expect(sets.length).toBeGreaterThan(0);
  });

  it('marks the analyser unavailable when the firmware lacks it', async () => {
    const { device, session } = await rig({ platform: 'rp2350', wireVersion: 29 });
    expect(await setupRta(session, device)).toBe(false);
    expect(session.telemetry.rtaAvailability).toBe('unavailable');
    expect(session.telemetry.rtaCaps).toBeNull();
  });

  it('re-checks the config on a new interest period without re-reading caps', async () => {
    const { device, session } = await rig();
    const tele = session.telemetry;
    const release = tele.wantRta();
    await setupRta(session, device);
    release();
    const caps = tele.rtaCaps;
    await device.setRtaConfig({ tap: Domain.RtaTap.Input, channelMask: 0b11, fftOrder: 9, avgMs: 0, peakDecayDbS: 0, flags: 0 });
    tele.wantRta();
    expect(tele.rtaConfigured).toBe(false);
    await setupRta(session, device);
    expect(tele.rtaCaps).toBe(caps);
    expect(tele.rtaConfig?.tap).toBe(Domain.RtaTap.Output);
  });
});

describe('setupRta failures', () => {
  it('latches unavailable on a pre-V3 analyser layout', async () => {
    const { device, session } = await rig({ platform: 'rp2350', wireVersion: 30 });
    expect(await setupRta(session, device)).toBe(false);
    expect(session.telemetry.rtaAvailability).toBe('unavailable');
  });

  it('retries after a config read failure once caps proved the module', async () => {
    let fail = true;
    const { device, session } = await rig(undefined, (req, real) => {
      if (fail && req === WireCmd.RtaGetConfig.code) throw new Error('boom');
      return real;
    });
    expect(await setupRta(session, device)).toBe(false);
    expect(session.telemetry.rtaAvailability).toBe('unknown');
    expect(session.telemetry.rtaConfigured).toBe(false);
    fail = false;
    expect(await setupRta(session, device)).toBe(true);
    expect(session.telemetry.rtaConfigured).toBe(true);
  });

  it('lets a timeout propagate and leaves availability undecided', async () => {
    const { device, session } = await rig(undefined, (req, real) => {
      if (req === WireCmd.RtaGetCaps.code) throw new TimeoutError('ctrlIn', 2000);
      return real;
    });
    await expect(setupRta(session, device)).rejects.toBeInstanceOf(TimeoutError);
    expect(session.telemetry.rtaAvailability).toBe('unknown');
  });
});

describe('readRtaFrames', () => {
  it('stores dBFS frames per wire output and drops them when interest ends', async () => {
    const { device, session } = await rig();
    const tele = session.telemetry;
    const release = tele.wantRta();
    await setupRta(session, device);
    await readRtaFrames(session, device, true);
    expect(tele.rtaFrames.length).toBeGreaterThan(0);
    expect(tele.rtaFrames[0].levelsDb.every((db) => db < 0)).toBe(true);
    expect(tele.rtaStatus?.state).not.toBe(Domain.RtaState.Idle);
    expect(tele.lastRtaReplyMs).toBeGreaterThan(0);
    release();
    expect(tele.rtaFrames).toEqual([]);
    expect(tele.rtaStatus).toBeNull();
  });

  it('stamps a reply for an all-silent answer, with the frames decoded as floor', async () => {
    const { device, session } = await rig(undefined, (req, real) => {
      if (req === WireCmd.RtaGetBandsAll.code) for (let off = 0; off + 82 <= real.length; off += 82) { real[off + 4] = 0xFF; real[off + 5] = 0xFF; }
      return real;
    });
    session.telemetry.wantRta();
    await setupRta(session, device);
    await readRtaFrames(session, device, false);
    expect(session.telemetry.rtaFrames.length).toBeGreaterThan(0);
    expect(session.telemetry.lastRtaReplyMs).toBeGreaterThan(0);
    expect(session.telemetry.rtaFrames.every((f) => f.levelsDb.every((db) => db === -Infinity))).toBe(true);
  });

  it('redoes setup when the status shows the analyser left the output tap', async () => {
    const { device, session } = await rig(undefined, (req, real) => {
      if (req === WireCmd.RtaGetStatus.code) real[2] = Domain.RtaTap.Input;
      return real;
    });
    session.telemetry.wantRta();
    await setupRta(session, device);
    expect(session.telemetry.rtaConfigured).toBe(true);
    await readRtaFrames(session, device, true);
    expect(session.telemetry.rtaConfigured).toBe(false);
  });
});
