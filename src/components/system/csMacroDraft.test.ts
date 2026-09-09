import { describe, it, expect } from 'vitest';
import {
  CsNoun, CsAction, CsKind,
  CS_UNIT_NONE, CS_UNIT_DB,
  CS_TARGET_NONE, CS_TARGET_INPUT_CH,
  CS_FLAG_GROUP, CS_FLAG_WRAP,
  CS_MAX_MACRO_STEPS,
  EMPTY_CS_MACRO_STEP,
  dbToQ8,
  type CsNounCaps, type CsMacro, type CsMacroStep,
} from '@/domain';
import {
  defaultStepDraft, macroDraftFromLive, buildMacro, buildMacroStep, macrosEqual,
  type StepDraft,
} from './csMacroDraft';

// Minimal caps-v9 shaped noun table: only the nouns exercised below are
// filled in, same convention as csDraft.test.ts.
const disabledNoun: CsNounCaps = {
  kind: CsKind.Bool, enumCount: 0, actions: 0, minQ8: 0, maxQ8: 0,
  unit: CS_UNIT_NONE, targetKind: CS_TARGET_NONE, targetCount: 0, dflags: 0,
};

const nouns: CsNounCaps[] = [
  ...Array(2).fill(disabledNoun),                                                  // 0..1
  { kind: CsKind.Bool, enumCount: 0, actions: 0x0370, minQ8: 0, maxQ8: 0,
    unit: CS_UNIT_NONE, targetKind: CS_TARGET_NONE, targetCount: 0, dflags: 0 },    // 2  USER_MUTE
  ...Array(3).fill(disabledNoun),                                                  // 3..5
  { kind: CsKind.Enum, enumCount: 10, actions: 0x012E, minQ8: 0, maxQ8: 0,
    unit: CS_UNIT_NONE, targetKind: CS_TARGET_NONE, targetCount: 0, dflags: 0 },    // 6  PRESET
  ...Array(9).fill(disabledNoun),                                                  // 7..15
  { kind: CsKind.Continuous, enumCount: 0, actions: 0x0C2F, minQ8: -6144, maxQ8: 6144,
    unit: CS_UNIT_DB, targetKind: CS_TARGET_INPUT_CH, targetCount: 2, dflags: 0 },  // 16 PREAMP
];

const emptyStep = (): CsMacroStep => ({ ...EMPTY_CS_MACRO_STEP });

describe('macro draft round-trip', () => {
  it('round-trips a grouped SET step and a wrapped enum INC step, tail steps empty', () => {
    const liveMacro: CsMacro = {
      name: 'Night',
      stepCount: 2,
      steps: [
        {
          noun: CsNoun.Preamp, action: CsAction.Set, flags: CS_FLAG_GROUP,
          target: 0, index: 0, value: dbToQ8(-6), step: 0, preDelay: 150,
        },
        {
          noun: CsNoun.Preset, action: CsAction.Inc, flags: CS_FLAG_WRAP,
          target: 0, index: 0, value: 0, step: 1, preDelay: 0,
        },
        ...Array.from({ length: 6 }, emptyStep),
      ],
    };

    const draft = macroDraftFromLive(liveMacro, nouns);
    expect(draft.steps).toHaveLength(2);
    expect(draft.steps[0].preDelay).toBeCloseTo(1.5, 6);

    expect(buildMacro(draft, nouns)).toEqual(liveMacro);
  });
});

describe('buildMacroStep conditional encoding', () => {
  it('drops GROUP on an untargeted noun and WRAP on a non-steppy action', () => {
    const d: StepDraft = {
      noun: CsNoun.UserMute, action: CsAction.Set, target: 5, index: 3,
      grouped: true, wrap: true, value: 1, step: 0, preDelay: 0,
    };
    const built = buildMacroStep(d, nouns);
    expect(built.flags & CS_FLAG_GROUP).toBe(0);
    expect(built.flags & CS_FLAG_WRAP).toBe(0);
    expect(built.target).toBe(0);
  });

  it('keeps WRAP on an enum INC', () => {
    const d: StepDraft = {
      noun: CsNoun.Preset, action: CsAction.Inc, target: 2, index: 0,
      grouped: false, wrap: true, value: 0, step: 1, preDelay: 0,
    };
    const built = buildMacroStep(d, nouns);
    expect(built.flags & CS_FLAG_WRAP).toBe(CS_FLAG_WRAP);
  });
});

describe('buildMacro', () => {
  it('caps stepCount at CS_MAX_MACRO_STEPS even when the draft carries more', () => {
    const many = Array.from({ length: 10 }, () => defaultStepDraft(nouns));
    const built = buildMacro({ name: '', steps: many }, nouns);
    expect(built.stepCount).toBe(CS_MAX_MACRO_STEPS);
    expect(built.steps).toHaveLength(CS_MAX_MACRO_STEPS);
  });
});

describe('macrosEqual', () => {
  const stepA: CsMacroStep = {
    noun: CsNoun.Preamp, action: CsAction.Set, flags: CS_FLAG_GROUP,
    target: 0, index: 0, value: dbToQ8(-6), step: 0, preDelay: 150,
  };
  const stepB: CsMacroStep = {
    noun: CsNoun.Preset, action: CsAction.Inc, flags: CS_FLAG_WRAP,
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
    expect(macrosEqual(base, withStaleChange)).toBe(true);
  });

  it('notices a preDelay change inside stepCount', () => {
    const withLiveChange: CsMacro = {
      ...base,
      steps: [{ ...stepA, preDelay: 999 }, stepB, ...Array.from({ length: 6 }, emptyStep)],
    };
    expect(macrosEqual(base, withLiveChange)).toBe(false);
  });
});
