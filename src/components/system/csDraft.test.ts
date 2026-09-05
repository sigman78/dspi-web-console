import { describe, it, expect } from 'vitest';
import {
  CsType, CsNoun, CsAction, CsKind, CsEvent,
  CS_FLAG_INVERT, CS_FLAG_REVERSE, CS_FLAG_ACCEL, CS_FLAG_REPEAT,
  CS_UNIT_NONE, CS_UNIT_DB, CS_UNIT_HZ,
  CS_TARGET_NONE, CS_TARGET_DSP_BAND,
  EMPTY_CS_BINDING,
  type CsBinding, type CsCaps, type CsNounCaps,
} from '@/domain';
import { draftFromLive, buildBinding, bindingsEqual, type Draft } from './csDraft';

// Minimal caps-v3 shaped tables (same real values as controlSurfaces.test.ts);
// only the types/nouns exercised below are filled in.
const caps: CsCaps = {
  capsVersion: 3,
  maxBindings: 16,
  maxIrCommands: 8,
  maxGroups: 0,
  maxMacros: 0,
  maxMacroSteps: 0,
  types: [
    { actions: 0x0000, pinCount: 0, pinClass: 0 },   // NONE
    { actions: 0x02BC, pinCount: 1, pinClass: 0 },   // BUTTON
    { actions: 0x0040, pinCount: 1, pinClass: 0 },   // SWITCH
    { actions: 0x0001, pinCount: 1, pinClass: 1 },   // POT (ADC)
    { actions: 0x0002, pinCount: 2, pinClass: 0 },   // ENCODER
    { actions: 0x0500, pinCount: 1, pinClass: 0 },   // LED
    { actions: 0x0D00, pinCount: 1, pinClass: 0 },   // LED_PWM
    { actions: 0x02BC, pinCount: 1, pinClass: 0 },   // IR
  ],
};

const disabledNoun: CsNounCaps = {
  kind: CsKind.Bool, enumCount: 0, actions: 0, minQ8: 0, maxQ8: 0,
  unit: CS_UNIT_NONE, targetKind: CS_TARGET_NONE, targetCount: 0, dflags: 0,
};

const nouns: CsNounCaps[] = [
  { kind: CsKind.Continuous, enumCount: 0, actions: 0x0C2F, minQ8: -15360, maxQ8: 0,
    unit: CS_UNIT_DB, targetKind: CS_TARGET_NONE, targetCount: 0, dflags: 0 },      // 0  USER_VOLUME
  disabledNoun,                                                                     // 1
  { kind: CsKind.Bool, enumCount: 0, actions: 0x0370, minQ8: 0, maxQ8: 0,
    unit: CS_UNIT_NONE, targetKind: CS_TARGET_NONE, targetCount: 0, dflags: 0 },    // 2  USER_MUTE
  ...Array(17).fill(disabledNoun),                                                  // 3..19
  { kind: CsKind.Continuous, enumCount: 0, actions: 0x0C2F, minQ8: 20, maxQ8: 20000,
    unit: CS_UNIT_HZ, targetKind: CS_TARGET_DSP_BAND, targetCount: 7, dflags: 0 },  // 20 FILTER_FREQ
];

// Caps v13: unlocks indicator delays (v8) and the brightness ceiling (v12) on
// top of the same type/noun tables as `caps`.
const caps13: CsCaps = { ...caps, capsVersion: 13 };

function live(over: Partial<CsBinding>): CsBinding {
  return { ...EMPTY_CS_BINDING, ...over };
}

function roundTrip(b: CsBinding, c: CsCaps = caps): CsBinding {
  return buildBinding(draftFromLive(b, nouns), nouns, c);
}

// The no-op-APPLY invariant: a live binding turned into a display-unit draft
// and rebuilt must equal the original wire binding, or every untouched slot
// would read as dirty. Exercises Q8<->display conversion both ways.
describe('csDraft round-trip', () => {
  it('reproduces a button Set binding with a dB value and gestures', () => {
    const b = live({
      type: CsType.Button, noun: CsNoun.UserVolume, action: CsAction.Set,
      event: CsEvent.Double, gpio0: 14, gpio1: null, flags: CS_FLAG_INVERT,
      value: -3200,                                  // -12.5 dB, exact in Q8
    });
    expect(bindingsEqual(roundTrip(b), b)).toBe(true);
  });

  it('reproduces a range-limited pot Adjust binding', () => {
    const b = live({
      type: CsType.Pot, noun: CsNoun.UserVolume, action: CsAction.Adjust,
      gpio0: 26, gpio1: null, rangeMin: -5120, rangeMax: 0,  // -20..0 dB
    });
    expect(bindingsEqual(roundTrip(b), b)).toBe(true);
  });

  it('reproduces an encoder Step binding on a Hz noun with an octave step and band target', () => {
    const b = live({
      type: CsType.Encoder, noun: CsNoun.FilterFreq, action: CsAction.Step,
      gpio0: 11, gpio1: 12, flags: CS_FLAG_REVERSE | CS_FLAG_ACCEL,
      target: 3, index: 2, step: 128,                // 0.5 octaves
    });
    expect(bindingsEqual(roundTrip(b), b)).toBe(true);
  });

  it('carries reserved wire bytes through untouched', () => {
    const b = live({
      type: CsType.Button, noun: CsNoun.UserMute, action: CsAction.Toggle,
      gpio0: 14, reserved2: [1, 2],
    });
    const rebuilt = roundTrip(b);
    expect(rebuilt.reserved2).toEqual([1, 2]);
  });

  it('reproduces an LED_PWM IND_ABOVE binding with a brightness ceiling and delays', () => {
    const b = live({
      type: CsType.LedPwm, noun: CsNoun.UserVolume, action: CsAction.IndAbove,
      gpio0: 20, gpio1: null, value: 0, baseBright: 40, onDelay: 5, offDelay: 6000,
    });
    expect(bindingsEqual(roundTrip(b, caps13), b)).toBe(true);
  });

  // Wire 0 (full) and wire 100 both display as 100 %, told apart only by the
  // limitBright toggle; both must rebuild to their own wire value or every
  // untouched PWM LED on a caps-12+ device would read as dirty.
  it('reproduces a full-brightness LED_PWM binding (base_bright 0) and a 100 % ceiling', () => {
    const full = live({
      type: CsType.LedPwm, noun: CsNoun.UserVolume, action: CsAction.IndAbove,
      gpio0: 20, gpio1: null, baseBright: 0,
    });
    expect(bindingsEqual(roundTrip(full, caps13), full)).toBe(true);
    const ceiling100 = live({ ...full, baseBright: 100 });
    expect(bindingsEqual(roundTrip(ceiling100, caps13), ceiling100)).toBe(true);
  });
});

describe('buildBinding conditional encoding', () => {
  // A draft accumulates values as the user flips between types/nouns/actions;
  // fields the final shape doesn't use must be zeroed on the wire, not leak.
  it('zeroes operands and masks flags the current shape does not use', () => {
    const d: Draft = {
      type: CsType.Button, noun: CsNoun.UserMute, action: CsAction.Toggle,
      event: CsEvent.Press, gpio0: 14,
      // Stale junk from earlier edits on other types/nouns:
      gpio1: 7, target: 1, index: 2, value: 5, step: 3,
      limitRange: true, rangeMin: -10, rangeMax: 10,
      invert: true, reverse: true, wrap: true, accel: true, repeat: false,
      onDelay: 5, offDelay: 6, limitBright: true, baseBright: 40,
    };
    expect(buildBinding(d, nouns, caps)).toEqual(live({
      type: CsType.Button, noun: CsNoun.UserMute, action: CsAction.Toggle,
      event: CsEvent.Press, gpio0: 14, gpio1: null,
      flags: CS_FLAG_INVERT,                         // reverse/wrap/accel masked
      reserved2: undefined,                          // no live binding to carry it from
    }));
  });

  it('forces the press event for momentary and auto-repeat buttons and for non-buttons', () => {
    const base: Draft = {
      type: CsType.Button, noun: CsNoun.UserMute, action: CsAction.Momentary,
      event: CsEvent.Long, gpio0: 14, gpio1: 0, target: 0, index: 0,
      invert: false, reverse: false, wrap: false, accel: false, repeat: false,
      value: 1, step: 0, limitRange: false, rangeMin: 0, rangeMax: 0,
      onDelay: 0, offDelay: 0, limitBright: false, baseBright: 100,
    };
    expect(buildBinding(base, nouns, caps).event).toBe(CsEvent.Press);

    const repeat = { ...base, noun: CsNoun.UserVolume as number, action: CsAction.Inc as number, event: CsEvent.Double as number, repeat: true };
    const rb = buildBinding(repeat, nouns, caps);
    expect(rb.event).toBe(CsEvent.Press);
    expect(rb.flags & CS_FLAG_REPEAT).toBe(CS_FLAG_REPEAT);

    const pot = { ...base, type: CsType.Pot as number, noun: CsNoun.UserVolume as number, action: CsAction.Adjust as number, event: CsEvent.Long as number };
    expect(buildBinding(pot, nouns, caps).event).toBe(CsEvent.Press);
  });

  // The IR container carries only the receiver pin and wiring polarity;
  // firmware's validateCsBinding rejects anything else non-zero.
  it('zeroes everything but gpio0, invert, and reserved bytes for an IR binding', () => {
    const d: Draft = {
      type: CsType.Ir, noun: 5, action: 3, event: CsEvent.Long,
      gpio0: 15, gpio1: 8, target: 1, index: 2, value: 9, step: 4,
      limitRange: true, rangeMin: -10, rangeMax: 10,
      invert: true, reverse: true, wrap: true, accel: true, repeat: true,
      onDelay: 5, offDelay: 6, limitBright: true, baseBright: 40,
      reserved2: [7],
    };
    expect(buildBinding(d, nouns, caps)).toEqual(live({
      type: CsType.Ir, gpio0: 15, gpio1: null, flags: CS_FLAG_INVERT,
      event: CsEvent.Press, reserved2: [7],
    }));
  });

  it('carries the brightness ceiling on IND_LEVEL but zeroes delays there', () => {
    const d: Draft = {
      type: CsType.LedPwm, noun: CsNoun.UserVolume, action: CsAction.IndLevel,
      event: CsEvent.Press, gpio0: 20, gpio1: 0, target: 0, index: 0,
      invert: false, reverse: false, wrap: false, accel: false, repeat: false,
      value: 0, step: 0, limitRange: false, rangeMin: 0, rangeMax: 0,
      onDelay: 5, offDelay: 6, limitBright: true, baseBright: 40,
    };
    const built = buildBinding(d, nouns, caps13);
    expect(built.onDelay).toBe(0);
    expect(built.offDelay).toBe(0);
    expect(built.baseBright).toBe(40);
  });

  it('zeroes the brightness ceiling on a plain LED even when the draft carries one', () => {
    const d: Draft = {
      type: CsType.Led, noun: CsNoun.UserVolume, action: CsAction.IndEquals,
      event: CsEvent.Press, gpio0: 20, gpio1: 0, target: 0, index: 0,
      invert: false, reverse: false, wrap: false, accel: false, repeat: false,
      value: 1, step: 0, limitRange: false, rangeMin: 0, rangeMax: 0,
      onDelay: 0, offDelay: 0, limitBright: true, baseBright: 40,
    };
    expect(buildBinding(d, nouns, caps13).baseBright).toBe(0);
  });

  it('zeroes delays and the brightness ceiling below the caps versions that support them', () => {
    const d: Draft = {
      type: CsType.Led, noun: CsNoun.UserVolume, action: CsAction.IndAbove,
      event: CsEvent.Press, gpio0: 20, gpio1: 0, target: 0, index: 0,
      invert: false, reverse: false, wrap: false, accel: false, repeat: false,
      value: 0, step: 0, limitRange: false, rangeMin: 0, rangeMax: 0,
      onDelay: 5, offDelay: 6, limitBright: true, baseBright: 40,
    };
    const built = buildBinding(d, nouns, caps);   // caps.capsVersion === 3
    expect(built.onDelay).toBe(0);
    expect(built.offDelay).toBe(0);
    expect(built.baseBright).toBe(0);
  });

  it('builds baseBright 0 when limitBright is false even on a capable LED_PWM', () => {
    const d: Draft = {
      type: CsType.LedPwm, noun: CsNoun.UserVolume, action: CsAction.IndAbove,
      event: CsEvent.Press, gpio0: 20, gpio1: 0, target: 0, index: 0,
      invert: false, reverse: false, wrap: false, accel: false, repeat: false,
      value: 0, step: 0, limitRange: false, rangeMin: 0, rangeMax: 0,
      onDelay: 0, offDelay: 0, limitBright: false, baseBright: 55,
    };
    expect(buildBinding(d, nouns, caps13).baseBright).toBe(0);
  });
});
