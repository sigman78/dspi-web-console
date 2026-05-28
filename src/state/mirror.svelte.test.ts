import { describe, it, expect, beforeEach } from 'vitest';
import {
  mirror, presetBaseline,
  inflight, isInFlight,
  bumpInflight, dropInflight,
} from './mirror.svelte';
import type { DspSnapshot } from '@/domain';

function fakeSnap(overrides: Partial<DspSnapshot> = {}): DspSnapshot {
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
    ...overrides,
  } as unknown as DspSnapshot;
}

describe('mirror store', () => {
  beforeEach(() => {
    mirror.reset();
    while (inflight.current > 0) dropInflight();
  });

  describe('init (atomic baseline)', () => {
    it('populates current and baseline together', () => {
      mirror.init(fakeSnap());
      expect(mirror.current).not.toBeNull();
      expect(presetBaseline.current).not.toBeNull();
    });

    it('baseline is a deep clone, not a shared reference', () => {
      mirror.init(fakeSnap());
      expect(presetBaseline.current).toEqual(mirror.current);
      expect(presetBaseline.current).not.toBe(mirror.current);
    });

    it('mutating current after init does not affect baseline', () => {
      mirror.init(fakeSnap());
      mirror.current!.bypass = true;
      expect(presetBaseline.current!.bypass).toBe(false);
    });

    it('a second init replaces both cells', () => {
      mirror.init(fakeSnap({ masterVolumeDb: -6 } as Partial<DspSnapshot>));
      mirror.init(fakeSnap({ masterVolumeDb: -12 } as Partial<DspSnapshot>));
      expect(mirror.current!.masterVolumeDb).toBe(-12);
      expect(presetBaseline.current!.masterVolumeDb).toBe(-12);
    });
  });

  describe('replaceCurrent (current-only refresh)', () => {
    it('advances current but leaves baseline pinned', () => {
      mirror.init(fakeSnap({ masterVolumeDb: -10 } as Partial<DspSnapshot>));
      const baselineBefore = presetBaseline.current;

      mirror.replaceCurrent(fakeSnap({ masterVolumeDb: -20 } as Partial<DspSnapshot>));

      expect(mirror.current!.masterVolumeDb).toBe(-20);
      expect(presetBaseline.current).toBe(baselineBefore);
      expect(presetBaseline.current!.masterVolumeDb).toBe(-10);
    });
  });

  describe('captureBaseline', () => {
    it('copies current to baseline', () => {
      mirror.init(fakeSnap());
      mirror.current!.bypass = true;
      expect(presetBaseline.current!.bypass).toBe(false);
      mirror.captureBaseline();
      expect(presetBaseline.current!.bypass).toBe(true);
    });

    it('does not share refs (subsequent edits to current do not propagate)', () => {
      mirror.init(fakeSnap());
      mirror.captureBaseline();
      mirror.current!.bypass = true;
      expect(presetBaseline.current!.bypass).toBe(false);
    });

    it('no-op when current is null', () => {
      mirror.reset();
      expect(() => mirror.captureBaseline()).not.toThrow();
    });
  });

  describe('reset', () => {
    it('clears current but preserves baseline', () => {
      mirror.init(fakeSnap());
      const baselineBefore = presetBaseline.current;
      mirror.reset();
      expect(mirror.current).toBeNull();
      expect(presetBaseline.current).toBe(baselineBefore);
    });
  });

  describe('inflight counter', () => {
    it('starts at zero', () => {
      expect(inflight.current).toBe(0);
      expect(isInFlight.current).toBe(false);
    });

    it('bumps and drops symmetrically', () => {
      bumpInflight();
      bumpInflight();
      expect(inflight.current).toBe(2);
      expect(isInFlight.current).toBe(true);
      dropInflight();
      expect(inflight.current).toBe(1);
      dropInflight();
      expect(inflight.current).toBe(0);
      expect(isInFlight.current).toBe(false);
    });

    it('dropInflight at 0 stays at 0', () => {
      dropInflight();
      expect(inflight.current).toBe(0);
    });
  });
});
