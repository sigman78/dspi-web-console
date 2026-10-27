import { describe, it, expect } from 'vitest';
import * as Domain from '@/domain';
import type { CsNounCaps, CsMacro, CsMacroStep } from '@/domain';
import * as CsMacroDraft from './macroDraft';
import type { StepDraft } from './macroDraft';
import { csNouns, disabledNoun } from '@test/fixtures/csCaps';

// Minimal caps-v9 shaped noun table: only the nouns exercised below are
// filled in, same convention as draft.test.ts.
const nouns: CsNounCaps[] = [
  ...Array(2).fill(disabledNoun),                                                  // 0..1
  csNouns[Domain.CsNoun.UserMute],                                                        // 2  USER_MUTE
  ...Array(3).fill(disabledNoun),                                                  // 3..5
  csNouns[Domain.CsNoun.Preset],                                                          // 6  PRESET
  ...Array(9).fill(disabledNoun),                                                  // 7..15
  csNouns[Domain.CsNoun.Preamp],                                                          // 16 PREAMP
];

const emptyStep = (): CsMacroStep => ({ ...Domain.EMPTY_CS_MACRO_STEP });

describe('macro draft round-trip', () => {
  it('round-trips a grouped SET step and a wrapped enum INC step, tail steps empty', () => {
    const liveMacro: CsMacro = {
      name: 'Night',
      stepCount: 2,
      steps: [
        {
          noun: Domain.CsNoun.Preamp, action: Domain.CsAction.Set, flags: Domain.CS_FLAG_GROUP,
          target: 0, index: 0, value: Domain.dbToQ8(-6), step: 0, preDelay: 150,
        },
        {
          noun: Domain.CsNoun.Preset, action: Domain.CsAction.Inc, flags: Domain.CS_FLAG_WRAP,
          target: 0, index: 0, value: 0, step: 1, preDelay: 0,
        },
        ...Array.from({ length: 6 }, emptyStep),
      ],
    };

    const draft = CsMacroDraft.macroDraftFromLive(liveMacro, nouns);
    expect(draft.steps).toHaveLength(2);
    expect(draft.steps[0].preDelay).toBeCloseTo(1.5, 6);

    expect(CsMacroDraft.buildMacro(draft, nouns)).toEqual(liveMacro);
  });
});

describe('buildMacroStep conditional encoding', () => {
  it('drops GROUP on an untargeted noun and WRAP on a non-steppy action', () => {
    const d: StepDraft = {
      noun: Domain.CsNoun.UserMute, action: Domain.CsAction.Set, target: 5, index: 3,
      grouped: true, wrap: true, value: 1, step: 0, preDelay: 0,
    };
    const built = CsMacroDraft.buildMacroStep(d, nouns);
    expect(built.flags & Domain.CS_FLAG_GROUP).toBe(0);
    expect(built.flags & Domain.CS_FLAG_WRAP).toBe(0);
    expect(built.target).toBe(0);
  });

  it('keeps WRAP on an enum INC', () => {
    const d: StepDraft = {
      noun: Domain.CsNoun.Preset, action: Domain.CsAction.Inc, target: 2, index: 0,
      grouped: false, wrap: true, value: 0, step: 1, preDelay: 0,
    };
    const built = CsMacroDraft.buildMacroStep(d, nouns);
    expect(built.flags & Domain.CS_FLAG_WRAP).toBe(Domain.CS_FLAG_WRAP);
  });

  it('clamps an out-of-range step to the i16 wire range', () => {
    const d: StepDraft = {
      noun: Domain.CsNoun.Preset, action: Domain.CsAction.Inc, target: 0, index: 0,
      grouped: false, wrap: false, value: 0, step: 70000, preDelay: 0,
    };
    expect(CsMacroDraft.buildMacroStep(d, nouns).step).toBe(32767);
    expect(CsMacroDraft.buildMacroStep({ ...d, step: -70000 }, nouns).step).toBe(-32768);
  });
});

describe('buildMacro', () => {
  it('caps stepCount at CS_MAX_MACRO_STEPS even when the draft carries more', () => {
    const many = Array.from({ length: 10 }, () => CsMacroDraft.defaultStepDraft(nouns));
    const built = CsMacroDraft.buildMacro({ name: '', steps: many }, nouns);
    expect(built.stepCount).toBe(Domain.CS_MAX_MACRO_STEPS);
    expect(built.steps).toHaveLength(Domain.CS_MAX_MACRO_STEPS);
  });
});

describe('macrosEqual', () => {
  const stepA: CsMacroStep = {
    noun: Domain.CsNoun.Preamp, action: Domain.CsAction.Set, flags: Domain.CS_FLAG_GROUP,
    target: 0, index: 0, value: Domain.dbToQ8(-6), step: 0, preDelay: 150,
  };
  const stepB: CsMacroStep = {
    noun: Domain.CsNoun.Preset, action: Domain.CsAction.Inc, flags: Domain.CS_FLAG_WRAP,
    target: 0, index: 0, value: 0, step: 1, preDelay: 0,
  };
  const base: CsMacro = {
    name: 'X', stepCount: 1,
    steps: [stepA, stepB, ...Array.from({ length: 6 }, emptyStep)],
  };

  it('ignores a change in a stale step beyond stepCount', () => {
    const withStaleChange: CsMacro = {
      ...base,
      steps: [stepA, { ...stepB, preDelay: 999 }, ...Array.from({ length: 6 }, emptyStep)],
    };
    expect(CsMacroDraft.macrosEqual(base, withStaleChange)).toBe(true);
  });

  it('notices a preDelay change inside stepCount', () => {
    const withLiveChange: CsMacro = {
      ...base,
      steps: [{ ...stepA, preDelay: 999 }, stepB, ...Array.from({ length: 6 }, emptyStep)],
    };
    expect(CsMacroDraft.macrosEqual(base, withLiveChange)).toBe(false);
  });
});
