import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DspDevice } from './DspDevice';
import * as proto from '@/protocol';
import { openSingleDevice } from '@test/hil/setup';

// Per-output limiter (fw V32, REQ_LIMITER 0x81). Every SET is cross-checked
// against the bulk section 25 readback and the per-parameter GET. Group rules
// follow limiter_set_param: write-through on enable/threshold/release, a
// link-group SET makes the output adopt the lowest OTHER member, 0xFF fans out.

const F32_TOL = 4;
const Wire = proto.Wire;
const P = Wire.LimiterParam;

describe('DspDevice — output limiter (HIL, V32+)', () => {
  let device: DspDevice;
  let close: () => Promise<void>;
  let supported = false;
  let outputs = 0;

  beforeAll(async () => {
    const opened = await openSingleDevice();
    device = opened.device;
    close = opened.close;
    supported = device.info.capabilities.features.limiter;
    outputs = device.hardware.outputCount;
  });

  afterAll(async () => {
    if (close) await close();
  });

  // Restore through unlinked writes, then re-join each saved group.
  async function restore(saved: Awaited<ReturnType<DspDevice['getAllParams']>>['limiter']): Promise<void> {
    for (let k = 0; k < outputs; k++) await device.setLimiterLinkGroup(k, 0);
    for (let k = 0; k < outputs; k++) {
      await device.setLimiterThreshold(k, saved[k].thresholdDb);
      await device.setLimiterRelease(k, saved[k].releaseMs);
      await device.setLimiterEnabled(k, saved[k].enabled);
    }
    for (let k = 0; k < outputs; k++) await device.setLimiterLinkGroup(k, saved[k].linkGroup);
  }

  const bulk = async () => (await device.getAllParams()).limiter;

  it('enable/threshold/release: write -> getLimiterParam + bulk.limiter readback', async () => {
    if (!supported) return;
    const saved = await bulk();
    try {
      await device.setLimiterLinkGroup(0, 0);
      await device.setLimiterEnabled(0, true);
      await device.setLimiterThreshold(0, -12.5);
      await device.setLimiterRelease(0, 250);

      expect(await device.getLimiterParam(0, P.Enabled)).toBe(1);
      expect(await device.getLimiterParam(0, P.ThresholdDb)).toBeCloseTo(-12.5, F32_TOL);
      expect(await device.getLimiterParam(0, P.ReleaseMs)).toBeCloseTo(250, F32_TOL);
      const b = (await bulk())[0];
      expect(b.enabled).toBe(true);
      expect(b.thresholdDb).toBeCloseTo(-12.5, F32_TOL);
      expect(b.releaseMs).toBeCloseTo(250, F32_TOL);

      await device.setLimiterEnabled(0, false);
      expect((await bulk())[0].enabled).toBe(false);
    } finally {
      await restore(saved);
    }
    expect(await bulk()).toEqual(saved.map((o) => expect.objectContaining({ enabled: o.enabled, linkGroup: o.linkGroup })));
  });

  it('link group: above 4 clamps to 4', async () => {
    if (!supported) return;
    const saved = await bulk();
    try {
      await device.setLimiterLinkGroup(0, 9);
      expect(await device.getLimiterParam(0, P.LinkGroup)).toBe(4);
      expect((await bulk())[0].linkGroup).toBe(4);
    } finally {
      await restore(saved);
    }
  });

  it('0xFF fans a SET out to every real output', async () => {
    if (!supported) return;
    const saved = await bulk();
    try {
      for (let k = 0; k < outputs; k++) await device.setLimiterLinkGroup(k, 0);
      await device.setLimiterThreshold(Wire.LIMITER_ALL_OUTPUTS, -9);
      const after = await bulk();
      for (let k = 0; k < outputs; k++) expect(after[k].thresholdDb).toBeCloseTo(-9, F32_TOL);
    } finally {
      await restore(saved);
    }
  });

  it('a grouped threshold SET writes through to every member', async () => {
    if (!supported || outputs < 3) return;
    const saved = await bulk();
    try {
      for (let k = 0; k < outputs; k++) await device.setLimiterLinkGroup(k, 0);
      await device.setLimiterLinkGroup(1, 2);
      await device.setLimiterLinkGroup(2, 2);
      await device.setLimiterThreshold(2, -17);
      expect(await device.getLimiterParam(1, P.ThresholdDb)).toBeCloseTo(-17, F32_TOL);
      expect(await device.getLimiterParam(0, P.ThresholdDb)).not.toBeCloseTo(-17, F32_TOL);
    } finally {
      await restore(saved);
    }
  });

  it('a joiner adopts the lowest other member, even when the joiner has the lowest index', async () => {
    if (!supported || outputs < 3) return;
    const saved = await bulk();
    try {
      for (let k = 0; k < outputs; k++) await device.setLimiterLinkGroup(k, 0);
      await device.setLimiterLinkGroup(1, 3);
      await device.setLimiterLinkGroup(2, 3);
      await device.setLimiterThreshold(1, -6);
      await device.setLimiterRelease(1, 400);
      await device.setLimiterThreshold(0, -25);
      await device.setLimiterLinkGroup(0, 3);

      const after = await bulk();
      expect(after[0].linkGroup).toBe(3);
      expect(after[0].thresholdDb).toBeCloseTo(-6, F32_TOL);
      expect(after[0].releaseMs).toBeCloseTo(400, F32_TOL);
      expect(after[1].thresholdDb).toBeCloseTo(-6, F32_TOL);
      expect(after[2].thresholdDb).toBeCloseTo(-6, F32_TOL);
    } finally {
      await restore(saved);
    }
  });

  it('meter has one entry per output and status reports the 32-sample lookahead', async () => {
    if (!supported) return;
    expect((await device.getLimiterMeter()).length).toBe(outputs);
    expect((await device.getLimiterStatus()).lookaheadSamples).toBe(32);
  });

  it('a GET with a bad index rejects', async () => {
    if (!supported) return;
    await expect(device.getLimiterParam(0, 7 as proto.Wire.LimiterParam)).rejects.toThrow();
  });
});
