import { describe, expect, it } from 'vitest';
import { FilterType, Proc } from '@/domain';
import { makeSnapshot } from '@test/fixtures/snapshotFixtures';
import { chainBlocks, fmtSigned, liveRouteCount } from './chainModel';

const ALL = { psybass: true, subharm: true, upmix: true, limiter: true };
const keys = (f: typeof ALL) => chainBlocks(makeSnapshot(), f).map((b) => b.key);

describe('chainBlocks', () => {
  it('omits blocks whose feature flag is false and keeps firmware order', () => {
    expect(keys(ALL)).toEqual([
      'preamp', 'inputEq', 'leveller', 'upmix', 'matrix', 'crossfeed', 'subharm', 'psybass', 'loudness', 'outputs',
    ]);
    const k = keys({ ...ALL, psybass: false, upmix: false });
    expect(k).not.toContain('psybass');
    expect(k).not.toContain('upmix');
    expect(k).toContain('subharm');
  });

  it('marks only matrix and outputs as anchors', () => {
    const anchors = chainBlocks(makeSnapshot(), ALL).filter((b) => b.kind === 'anchor').map((b) => b.key);
    expect(anchors).toEqual(['matrix', 'outputs']);
  });

  it('counts routes and outputs from the snapshot', () => {
    const snap = makeSnapshot();
    snap.routes = snap.routes.map((r, i) => ({ ...r, enabled: i < 3 }));
    snap.outputs = snap.outputs.map((o, i) => ({ ...o, enabled: i < 4, muted: i === 1 }));
    const blocks = chainBlocks(snap, ALL);
    expect(blocks.find((b) => b.key === 'matrix')!.values).toEqual(['3 routes']);
    const out = blocks.find((b) => b.key === 'outputs')!.values;
    expect(out.slice(0, 2)).toEqual(['4 on', '1 muted']);
    snap.outputs = snap.outputs.map((o) => ({ ...o, muted: false }));
    const quiet = chainBlocks(snap, ALL).find((b) => b.key === 'outputs')!.values;
    expect(quiet.some((v) => v.includes('muted'))).toBe(false);
  });

  it('drops the limiter count without the limiter feature', () => {
    const out = chainBlocks(makeSnapshot(), { ...ALL, limiter: false }).find((b) => b.key === 'outputs')!;
    expect(out.values.some((v) => v.startsWith('lim'))).toBe(false);
  });

  it('shows off for a disabled switchable block and exposes its state', () => {
    const snap = makeSnapshot();
    snap.crossfeed.enabled = false;
    snap.loudness.enabled = true;
    const blocks = chainBlocks(snap, ALL);
    const cf = blocks.find((b) => b.key === 'crossfeed')!;
    expect(cf.enabled).toBe(false);
    expect(cf.values).toEqual(['off']);
    expect(blocks.find((b) => b.key === 'loudness')!.enabled).toBe(true);
    expect(blocks.find((b) => b.key === 'matrix')!.enabled).toBeNull();
  });

  it('reports the input preamp range signed', () => {
    const snap = makeSnapshot();
    snap.masterPreampDb = 0;
    snap.inputPreampDb = [0, -1.5];
    expect(chainBlocks(snap, ALL)[0].values).toEqual(['+0.0 dB', '−1.5/+0.0']);
  });
});

describe('input EQ value', () => {
  it('counts inputs having a non-Flat band', () => {
    const snap = makeSnapshot();
    const inputs = snap.channels.filter((c) => !c.isOutput);
    const value = () => chainBlocks(snap, ALL).find((b) => b.key === 'inputEq')!.values;
    for (const c of inputs) c.filters = c.filters.map((f) => ({ ...f, type: FilterType.Flat }));
    expect(value()).toEqual([`0 of ${inputs.length} inputs`]);
    inputs[0].filters[0] = { ...inputs[0].filters[0], type: FilterType.Peaking };
    expect(value()).toEqual([`1 of ${inputs.length} inputs`]);
  });
});

describe('fmtSigned', () => {
  it('uses a true minus and never shows -0.0', () => {
    expect(fmtSigned(-6)).toBe('−6.0');
    expect(fmtSigned(3.25, 1)).toBe('+3.3');
    expect(fmtSigned(-0.02)).toBe('+0.0');
  });
});

describe('liveRouteCount', () => {
  it('ignores enabled routes that target a disabled output', () => {
    const snap = makeSnapshot();
    snap.routes = snap.routes.map((r) => ({ ...r, enabled: false }));
    const [a, b] = snap.outputs;
    snap.outputs = snap.outputs.map((o) => ({ ...o, enabled: o.wireIndex !== b.wireIndex }));
    const onA = snap.routes.find((r) => r.outputWireIndex === a.wireIndex)!;
    const onB = snap.routes.find((r) => r.outputWireIndex === b.wireIndex)!;
    onA.enabled = true;
    onB.enabled = true;
    expect(liveRouteCount(snap)).toBe(1);
    expect(chainBlocks(snap, ALL).find((k) => k.key === 'matrix')!.values).toEqual(['1 route']);
  });
});

describe('subharm chain values', () => {
  it('shows Off for a band at the floor', () => {
    const snap = makeSnapshot();
    snap.subharm.enabled = true;
    snap.subharm.lowDb = Proc.SUBHARM_LEVEL_MIN_DB;
    snap.subharm.highDb = -6;
    expect(chainBlocks(snap, ALL).find((b) => b.key === 'subharm')!.values).toEqual(['Off', '−6.0']);
  });
});
