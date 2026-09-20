import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DspDevice } from './DspDevice';
import { openSingleDevice } from '@test/hil/setup';

// Subharmonic synthesizer (fw 1.1.6, wire V29). Every SET is cross-checked
// against the bulk section 23 readback and, for the mask, the direct GET.
// The headroom GET is live-computed by fw: 0 while disabled, > 0 once any
// band is enabled -- the panel's RESERVE affordance depends on that contract.

const F32_TOL = 4;

describe('DspDevice — subharmonic synthesizer (HIL, V29+)', () => {
  let device: DspDevice;
  let close: () => Promise<void>;
  let supported = false;

  beforeAll(async () => {
    const opened = await openSingleDevice();
    device = opened.device;
    close = opened.close;
    supported = device.info.capabilities.features.subharm;
  });

  afterAll(async () => {
    if (close) await close();
  });

  it('enable/levels/boost: write→bulk.subharm readback, restored afterwards', async () => {
    if (!supported) return;
    const saved = (await device.getAllParams()).subharm;
    try {
      await device.setSubharmEnabled(true);
      await device.setSubharmLow(-6);
      await device.setSubharmHigh(2.5);
      await device.setSubharmBoost(3);

      const bulk = (await device.getAllParams()).subharm;
      expect(bulk.enabled).toBe(true);
      expect(bulk.lowDb).toBeCloseTo(-6, F32_TOL);
      expect(bulk.highDb).toBeCloseTo(2.5, F32_TOL);
      expect(bulk.boostDb).toBeCloseTo(3, F32_TOL);

      // Floor value (-30 = band off) survives the wire unchanged.
      await device.setSubharmLow(-30);
      expect((await device.getAllParams()).subharm.lowDb).toBeCloseTo(-30, F32_TOL);

      await device.setSubharmEnabled(false);
      expect((await device.getAllParams()).subharm.enabled).toBe(false);
    } finally {
      await device.setSubharmEnabled(saved.enabled);
      await device.setSubharmLow(saved.lowDb);
      await device.setSubharmHigh(saved.highDb);
      await device.setSubharmBoost(saved.boostDb);
    }
    const restored = (await device.getAllParams()).subharm;
    expect(restored.enabled).toBe(saved.enabled);
    expect(restored.lowDb).toBeCloseTo(saved.lowDb, F32_TOL);
    expect(restored.highDb).toBeCloseTo(saved.highDb, F32_TOL);
    expect(restored.boostDb).toBeCloseTo(saved.boostDb, F32_TOL);
  });

  it('output mask: write→getSubharmMask + bulk.subharm.outputMask cross-check', async () => {
    if (!supported) return;
    const saved = await device.getSubharmMask();
    try {
      for (const target of [0x0001, 0x0005, 0x0000, 0xFFFF]) {
        await device.setSubharmMask(target);
        expect(await device.getSubharmMask()).toBe(target);
        expect((await device.getAllParams()).subharm.outputMask).toBe(target);
      }
    } finally {
      await device.setSubharmMask(saved);
    }
    expect(await device.getSubharmMask()).toBe(saved);
  });

  it('headroom: 0 while disabled, > 0 with a band on, grows with level, back to 0', async () => {
    if (!supported) return;
    const saved = (await device.getAllParams()).subharm;
    try {
      await device.setSubharmEnabled(false);
      expect(await device.getSubharmHeadroom()).toBe(0);

      await device.setSubharmLow(0);
      await device.setSubharmHigh(-30);
      await device.setSubharmBoost(0);
      await device.setSubharmEnabled(true);
      const atZero = await device.getSubharmHeadroom();
      expect(atZero).toBeGreaterThan(0);

      await device.setSubharmLow(6);
      const atSix = await device.getSubharmHeadroom();
      expect(atSix).toBeGreaterThan(atZero);

      // Mask does not enter the headroom figure.
      await device.setSubharmMask(0x0000);
      expect(await device.getSubharmHeadroom()).toBeCloseTo(atSix, F32_TOL);
      await device.setSubharmMask(saved.outputMask);

      await device.setSubharmEnabled(false);
      expect(await device.getSubharmHeadroom()).toBe(0);
    } finally {
      await device.setSubharmLow(saved.lowDb);
      await device.setSubharmHigh(saved.highDb);
      await device.setSubharmBoost(saved.boostDb);
      await device.setSubharmMask(saved.outputMask);
      await device.setSubharmEnabled(saved.enabled);
    }
  });
});

describe('DspDevice — subharmonic synthesizer V30 extension (HIL, V30+)', () => {
  let device: DspDevice;
  let close: () => Promise<void>;
  let supported = false;

  beforeAll(async () => {
    const opened = await openSingleDevice();
    device = opened.device;
    close = opened.close;
    supported = device.info.capabilities.features.subharmExt;
  });

  afterAll(async () => {
    if (close) await close();
  });

  it('ext SETs: write -> bulk.subharm readback, restored afterwards', async () => {
    if (!supported) return;
    const saved = (await device.getAllParams()).subharm;
    try {
      await device.setSubharmTop(-3);
      await device.setSubharmSelect(1);
      await device.setSubharmDepth(60);
      await device.setSubharmHold(200);
      await device.setSubharmCeiling(-12);
      await device.setSubharmLink(false);

      const bulk = (await device.getAllParams()).subharm;
      expect(bulk.topDb).toBeCloseTo(-3, F32_TOL);
      expect(bulk.selectMode).toBe(1);
      expect(bulk.selectDepth).toBeCloseTo(60, F32_TOL);
      expect(bulk.selectHoldMs).toBeCloseTo(200, F32_TOL);
      expect(bulk.ceilingDb).toBeCloseTo(-12, F32_TOL);
      expect(bulk.linkPairs).toBe(false);
    } finally {
      await device.setSubharmTop(saved.topDb);
      await device.setSubharmSelect(saved.selectMode);
      await device.setSubharmDepth(saved.selectDepth);
      await device.setSubharmHold(saved.selectHoldMs);
      await device.setSubharmCeiling(saved.ceilingDb);
      await device.setSubharmLink(saved.linkPairs);
    }
    const restored = (await device.getAllParams()).subharm;
    expect(restored.topDb).toBeCloseTo(saved.topDb, F32_TOL);
    expect(restored.selectMode).toBe(saved.selectMode);
    expect(restored.selectDepth).toBeCloseTo(saved.selectDepth, F32_TOL);
    expect(restored.selectHoldMs).toBeCloseTo(saved.selectHoldMs, F32_TOL);
    expect(restored.ceilingDb).toBeCloseTo(saved.ceilingDb, F32_TOL);
    expect(restored.linkPairs).toBe(saved.linkPairs);
  });

  // caps v16 widened SUBHARM_LEVEL_MAX from +6 to +12 dB. A V29 device would
  // clamp both writes below to +6, so this pins the range to the firmware
  // rather than to our own constant.
  it('band level: +10 dB survives and an over-range write clamps to +12, not +6', async () => {
    if (!supported) return;
    const saved = (await device.getAllParams()).subharm;
    try {
      await device.setSubharmHigh(10);
      expect((await device.getAllParams()).subharm.highDb).toBeCloseTo(10, F32_TOL);

      await device.setSubharmHigh(20);
      expect((await device.getAllParams()).subharm.highDb).toBeCloseTo(12, F32_TOL);
    } finally {
      await device.setSubharmHigh(saved.highDb);
    }
    expect((await device.getAllParams()).subharm.highDb).toBeCloseTo(saved.highDb, F32_TOL);
  });

  it('solo: SET true -> GET true -> restored false, bulk.subharm unaffected', async () => {
    if (!supported) return;
    const bulkBefore = (await device.getAllParams()).subharm;
    try {
      await device.setSubharmSolo(true);
      expect(await device.getSubharmSolo()).toBe(true);
      const bulkDuring = (await device.getAllParams()).subharm;
      expect(bulkDuring).toEqual(bulkBefore);
    } finally {
      await device.setSubharmSolo(false);
    }
    expect(await device.getSubharmSolo()).toBe(false);
  });

  it('meter: returns numOutputs entries in 0..1', async () => {
    if (!supported) return;
    const meter = await device.getSubharmMeter();
    expect(meter.length).toBe(device.hardware.outputChannels.length);
    for (const v of meter) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
