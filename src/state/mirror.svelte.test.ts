import { describe, it, expect, beforeEach } from 'vitest';
import {
  mirror, presetBaseline,
  inflight, isInFlight,
  bumpInflight, dropInflight,
  requestReconcile, consumeReconcile, peekReconcile,
  noteWriteActivity, lastWriteMs,
  beginPresetGuard, endPresetGuard, presetGuardActive,
  MirrorState,
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

  describe('reconcile signal', () => {
    it('starts with nothing pending', () => {
      const { wanted, eager } = consumeReconcile();
      expect(wanted).toBe(false);
      expect(eager).toBe(false);
    });

    it('requestReconcile(false) sets wanted but not eager', () => {
      requestReconcile(false);
      const { wanted, eager } = consumeReconcile();
      expect(wanted).toBe(true);
      expect(eager).toBe(false);
    });

    it('requestReconcile(true) sets both wanted and eager', () => {
      requestReconcile(true);
      const { wanted, eager } = consumeReconcile();
      expect(wanted).toBe(true);
      expect(eager).toBe(true);
    });

    it('consumeReconcile clears the pending flags', () => {
      requestReconcile(true);
      consumeReconcile();
      const after = consumeReconcile();
      expect(after.wanted).toBe(false);
      expect(after.eager).toBe(false);
    });

    it('an eager request does not get downgraded by a later non-eager one', () => {
      requestReconcile(true);
      requestReconcile(false);
      const { wanted, eager } = consumeReconcile();
      expect(wanted).toBe(true);
      expect(eager).toBe(true);
    });

    it('peekReconcile reports flags without clearing them', () => {
      requestReconcile(true);
      const peeked = peekReconcile();
      expect(peeked).toEqual({ wanted: true, eager: true });
      // Still pending after a peek.
      expect(consumeReconcile()).toEqual({ wanted: true, eager: true });
    });

    it('reset clears pending reconcile flags', () => {
      requestReconcile(true);
      mirror.reset();
      const { wanted, eager } = consumeReconcile();
      expect(wanted).toBe(false);
      expect(eager).toBe(false);
    });
  });

  describe('write-activity timestamp', () => {
    it('starts at 0 (no activity)', () => {
      mirror.reset();
      expect(lastWriteMs()).toBe(0);
    });

    it('noteWriteActivity stamps a positive timestamp', () => {
      noteWriteActivity();
      expect(lastWriteMs()).toBeGreaterThan(0);
    });

    it('reset clears the write-activity timestamp', () => {
      noteWriteActivity();
      mirror.reset();
      expect(lastWriteMs()).toBe(0);
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

  describe('preset-op notify guard', () => {
    it('holds while a guard is open and for a trailing grace after it closes', () => {
      expect(presetGuardActive(1000)).toBe(false);

      beginPresetGuard();
      expect(presetGuardActive(1000)).toBe(true);    // depth held, time irrelevant

      beginPresetGuard();                            // nested
      endPresetGuard(500, 1000);                     // depth back to 1 — still held
      expect(presetGuardActive(1000)).toBe(true);

      endPresetGuard(500, 1000);                     // depth 0 — trailing until 1500
      expect(presetGuardActive(1400)).toBe(true);    // inside grace
      expect(presetGuardActive(1500)).toBe(false);   // grace elapsed
      expect(presetGuardActive(9999)).toBe(false);
    });

    it('reset() clears a held guard', () => {
      beginPresetGuard();
      beginPresetGuard();
      mirror.reset();
      expect(presetGuardActive(0)).toBe(false);
    });
  });
});

describe('MirrorState.snapshot', () => {
  it('returns current when set', () => {
    const m = new MirrorState();
    const snap = { masterVolumeDb: -10 } as never;
    m.init(snap);
    expect(m.snapshot).toBe(m.current);
    expect(m.snapshot).not.toBeNull();
  });
  it('throws when current is null', () => {
    const m = new MirrorState();
    expect(() => m.snapshot).toThrow();
  });
});
