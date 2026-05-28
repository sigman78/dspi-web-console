import { describe, it, expect, beforeEach } from 'vitest';
import * as mirror from './mirror.svelte';
import { dsp, resetDsp } from '@/state';
import type { DspSnapshot } from '@/domain';

function fakeSnap(): DspSnapshot {
  return {
    bypass: false,
    masterVolumeDb: 0,
    masterPreampDb: 0,
    inputPreampDb: [0, 0],
    channels: [],
    outputs: [],
    routes: [],
    crossfeed: { enabled: false, preset: 0, itd: false, freq: 700, feedDb: 0 },
    loudness: { enabled: false, refSpl: 85, intensityPct: 0 },
    leveller: null,
    i2s: null,
    outputPins: [],
    formatVersion: 6,
    platform: { type: 0, name: 'test', outputCount: 0, totalChannelCount: 0, pdmOutputIndex: -1 },
  } as unknown as DspSnapshot;
}

describe('mirror façade', () => {
  beforeEach(() => {
    resetDsp();
    while (mirror.inflight.current > 0) mirror.dropInflight();
  });

  it('init populates the mirror via applyBaselineSnapshot', () => {
    const snap = fakeSnap();
    mirror.init(snap);
    expect(dsp.draft).toBeTruthy();
    expect(dsp.draft?.bypass).toBe(false);
  });

  it('reset clears the mirror via resetDsp', () => {
    mirror.init(fakeSnap());
    mirror.reset();
    expect(dsp.draft).toBeNull();
  });

  it('inflight counter starts at zero', () => {
    expect(mirror.inflight.current).toBe(0);
  });

  it('inflight counter is bumpable and droppable', () => {
    mirror.bumpInflight();
    expect(mirror.inflight.current).toBe(1);
    mirror.bumpInflight();
    expect(mirror.inflight.current).toBe(2);
    mirror.dropInflight();
    expect(mirror.inflight.current).toBe(1);
    mirror.dropInflight();
    expect(mirror.inflight.current).toBe(0);
  });

  it('dropInflight at 0 stays at 0 (does not go negative)', () => {
    mirror.dropInflight();
    expect(mirror.inflight.current).toBe(0);
  });

  it('isInFlight reflects counter state', () => {
    expect(mirror.isInFlight.current).toBe(false);
    mirror.bumpInflight();
    expect(mirror.isInFlight.current).toBe(true);
    mirror.dropInflight();
    expect(mirror.isInFlight.current).toBe(false);
  });

  it('captureBaseline calls refreshSavedFromDraft when draft present', () => {
    const snap = fakeSnap();
    mirror.init(snap);
    if (dsp.draft) dsp.draft.bypass = true;
    mirror.captureBaseline();
    expect(dsp.saved?.bypass).toBe(true);
  });

  it('mirror.current returns dsp.draft', () => {
    mirror.init(fakeSnap());
    expect(mirror.mirror.current).toBe(dsp.draft);
  });

  it('presetBaseline.current returns dsp.saved', () => {
    mirror.init(fakeSnap());
    expect(mirror.presetBaseline.current).toBe(dsp.saved);
  });
});
