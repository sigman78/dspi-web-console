import { describe, it, expect } from 'vitest';
import { MirrorState } from './mirror.svelte';
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

describe('MirrorState', () => {
  describe('init (atomic baseline)', () => {
    it('populates current and baseline together as equal but distinct objects', () => {
      const m = new MirrorState();
      m.init(fakeSnap());
      expect(m.current).not.toBeNull();
      expect(m.baseline).not.toBeNull();
      expect(m.baseline).toEqual(m.current);
      expect(m.baseline).not.toBe(m.current);
    });

    it('mutating current after init does not affect baseline', () => {
      const m = new MirrorState();
      m.init(fakeSnap());
      m.current!.bypass = true;
      expect(m.baseline!.bypass).toBe(false);
    });

    it('a second init replaces both cells', () => {
      const m = new MirrorState();
      m.init(fakeSnap({ masterVolumeDb: -6 } as Partial<DspSnapshot>));
      m.init(fakeSnap({ masterVolumeDb: -12 } as Partial<DspSnapshot>));
      expect(m.current!.masterVolumeDb).toBe(-12);
      expect(m.baseline!.masterVolumeDb).toBe(-12);
    });
  });

  describe('replaceCurrent (current-only refresh)', () => {
    it('advances current but leaves baseline pinned', () => {
      const m = new MirrorState();
      m.init(fakeSnap({ masterVolumeDb: -10 } as Partial<DspSnapshot>));
      const baselineBefore = m.baseline;

      m.replaceCurrent(fakeSnap({ masterVolumeDb: -20 } as Partial<DspSnapshot>));

      expect(m.current!.masterVolumeDb).toBe(-20);
      expect(m.baseline).toBe(baselineBefore);
      expect(m.baseline!.masterVolumeDb).toBe(-10);
    });
  });

  describe('captureBaseline', () => {
    it('copies current to baseline', () => {
      const m = new MirrorState();
      m.init(fakeSnap());
      m.current!.bypass = true;
      expect(m.baseline!.bypass).toBe(false);
      m.captureBaseline();
      expect(m.baseline!.bypass).toBe(true);
    });

    it('no-op when current is null', () => {
      const m = new MirrorState();
      m.reset();
      expect(() => m.captureBaseline()).not.toThrow();
    });
  });

  describe('reset', () => {
    it('clears current but preserves baseline', () => {
      const m = new MirrorState();
      m.init(fakeSnap());
      const baselineBefore = m.baseline;
      m.reset();
      expect(m.current).toBeNull();
      expect(m.baseline).toBe(baselineBefore);
    });
  });

  describe('reconcile signal', () => {
    it('starts with nothing pending', () => {
      const m = new MirrorState();
      const { wanted, eager } = m.consumeReconcile();
      expect(wanted).toBe(false);
      expect(eager).toBe(false);
    });

    it('requestReconcile(false) sets wanted but not eager', () => {
      const m = new MirrorState();
      m.requestReconcile(false);
      const { wanted, eager } = m.consumeReconcile();
      expect(wanted).toBe(true);
      expect(eager).toBe(false);
    });

    it('requestReconcile(true) sets both wanted and eager', () => {
      const m = new MirrorState();
      m.requestReconcile(true);
      const { wanted, eager } = m.consumeReconcile();
      expect(wanted).toBe(true);
      expect(eager).toBe(true);
    });

    it('consumeReconcile clears the pending flags', () => {
      const m = new MirrorState();
      m.requestReconcile(true);
      m.consumeReconcile();
      const after = m.consumeReconcile();
      expect(after.wanted).toBe(false);
      expect(after.eager).toBe(false);
    });

    it('an eager request does not get downgraded by a later non-eager one', () => {
      const m = new MirrorState();
      m.requestReconcile(true);
      m.requestReconcile(false);
      const { wanted, eager } = m.consumeReconcile();
      expect(wanted).toBe(true);
      expect(eager).toBe(true);
    });

    it('peekReconcile reports flags without clearing them', () => {
      const m = new MirrorState();
      m.requestReconcile(true);
      const peeked = m.peekReconcile();
      expect(peeked).toEqual({ wanted: true, eager: true });
      // Still pending after a peek.
      expect(m.consumeReconcile()).toEqual({ wanted: true, eager: true });
    });

    it('reset clears pending reconcile flags', () => {
      const m = new MirrorState();
      m.requestReconcile(true);
      m.reset();
      const { wanted, eager } = m.consumeReconcile();
      expect(wanted).toBe(false);
      expect(eager).toBe(false);
    });
  });

  describe('preset-op notify guard', () => {
    it('holds while a guard is open and for a trailing grace after it closes', () => {
      const m = new MirrorState();
      expect(m.presetGuardActive(1000)).toBe(false);

      m.beginPresetGuard();
      expect(m.presetGuardActive(1000)).toBe(true);    // depth held, time irrelevant

      m.beginPresetGuard();                            // nested
      m.endPresetGuard(500, 1000);                     // depth back to 1 — still held
      expect(m.presetGuardActive(1000)).toBe(true);

      m.endPresetGuard(500, 1000);                     // depth 0 — trailing until 1500
      expect(m.presetGuardActive(1400)).toBe(true);    // inside grace
      expect(m.presetGuardActive(1500)).toBe(false);   // grace elapsed
      expect(m.presetGuardActive(9999)).toBe(false);
    });

    it('reset() clears a held guard', () => {
      const m = new MirrorState();
      m.beginPresetGuard();
      m.beginPresetGuard();
      m.reset();
      expect(m.presetGuardActive(0)).toBe(false);
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
