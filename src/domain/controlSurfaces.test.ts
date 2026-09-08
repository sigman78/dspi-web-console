import { describe, it, expect } from 'vitest';
import {
  CsType, CsNoun, CsAction, CsKind, CsEvent, CsIrProto,
  CS_FLAG_REVERSE, CS_FLAG_REPEAT, CS_FLAG_ACCEL,
  CS_FLAG_GROUP, CS_FLAG_LINK_ABS, CS_FLAG_GROUP_ALL,
  CS_UNIT_NONE, CS_UNIT_DB, CS_UNIT_HZ, CS_UNIT_Q,
  CS_TARGET_NONE, CS_TARGET_INPUT_CH, CS_TARGET_OUTPUT_CH, CS_TARGET_DSP_CH, CS_TARGET_DSP_BAND,
  dbToQ8, q8ToDb, legalActions, validateCsBinding, validateCsIrCommand, validateCsGroup, liveCsPinConfigs,
  EMPTY_CS_BINDING, EMPTY_CS_IR_COMMAND, EMPTY_CS_GROUP,
  type CsBinding, type CsCaps, type CsNounCaps, type CsStatus, type CsIrCommand, type CsGroup,
} from './controlSurfaces';

// Firmware caps-v3 tables as TEST INPUTS (the console itself reads them from
// the device at connect; see GetCsCaps). Only the nouns exercised below are
// filled in with real values -- the rest are inert placeholders.
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
    unit: CS_UNIT_DB, targetKind: CS_TARGET_NONE, targetCount: 0, dflags: 0 },       // 0  USER_VOLUME
  { kind: CsKind.Continuous, enumCount: 0, actions: 0x0C2F, minQ8: -32512, maxQ8: 0,
    unit: CS_UNIT_DB, targetKind: CS_TARGET_NONE, targetCount: 0, dflags: 0 },       // 1  MASTER_VOLUME
  { kind: CsKind.Bool, enumCount: 0, actions: 0x0370, minQ8: 0, maxQ8: 0,
    unit: CS_UNIT_NONE, targetKind: CS_TARGET_NONE, targetCount: 0, dflags: 0 },     // 2  USER_MUTE
  { kind: CsKind.Bool, enumCount: 0, actions: 0x0370, minQ8: 0, maxQ8: 0,
    unit: CS_UNIT_NONE, targetKind: CS_TARGET_NONE, targetCount: 0, dflags: 0 },     // 3  LOUDNESS
  { kind: CsKind.Bool, enumCount: 0, actions: 0x0370, minQ8: 0, maxQ8: 0,
    unit: CS_UNIT_NONE, targetKind: CS_TARGET_NONE, targetCount: 0, dflags: 0 },     // 4  CROSSFEED
  { kind: CsKind.Bool, enumCount: 0, actions: 0x0370, minQ8: 0, maxQ8: 0,
    unit: CS_UNIT_NONE, targetKind: CS_TARGET_NONE, targetCount: 0, dflags: 0 },     // 5  LEVELLER
  { kind: CsKind.Enum, enumCount: 10, actions: 0x012E, minQ8: 0, maxQ8: 0,
    unit: CS_UNIT_NONE, targetKind: CS_TARGET_NONE, targetCount: 0, dflags: 0 },     // 6  PRESET
  { kind: CsKind.Enum, enumCount: 3, actions: 0x012E, minQ8: 0, maxQ8: 0,
    unit: CS_UNIT_NONE, targetKind: CS_TARGET_NONE, targetCount: 0, dflags: 0 },     // 7  INPUT_SOURCE
  { kind: CsKind.Bool, enumCount: 0, actions: 0x0180, minQ8: 0, maxQ8: 0,
    unit: CS_UNIT_NONE, targetKind: CS_TARGET_NONE, targetCount: 0, dflags: 0 },     // 8  CLIP
  ...Array(7).fill(disabledNoun),                                                    // 9..15 (unused here)
  { kind: CsKind.Continuous, enumCount: 0, actions: 0x0C2F, minQ8: -6144, maxQ8: 6144,
    unit: CS_UNIT_DB, targetKind: CS_TARGET_INPUT_CH, targetCount: 2, dflags: 0 },   // 16 PREAMP
  disabledNoun,                                                                      // 17 (unused here)
  { kind: CsKind.Bool, enumCount: 0, actions: 0x0370, minQ8: 0, maxQ8: 0,
    unit: CS_UNIT_NONE, targetKind: CS_TARGET_OUTPUT_CH, targetCount: 3, dflags: 0 }, // 18 OUTPUT_MUTE
  disabledNoun,                                                                      // 19 (unused here)
  { kind: CsKind.Continuous, enumCount: 0, actions: 0x0C2F, minQ8: 20, maxQ8: 20000,
    unit: CS_UNIT_HZ, targetKind: CS_TARGET_DSP_BAND, targetCount: 7, dflags: 0 },   // 20 FILTER_FREQ
  disabledNoun,                                                                      // 21 (unused here)
  { kind: CsKind.Continuous, enumCount: 0, actions: 0x0C2F, minQ8: 26, maxQ8: 2560,
    unit: CS_UNIT_Q, targetKind: CS_TARGET_DSP_BAND, targetCount: 7, dflags: 0 },    // 22 FILTER_Q
];

function binding(over: Partial<CsBinding>): CsBinding {
  return { ...EMPTY_CS_BINDING, ...over };
}

// Groups land at caps v9; IR commands may carry CS_FLAG_GROUP from v10.
const capsV9: CsCaps = { ...caps, capsVersion: 9, maxGroups: 8 };
const capsV10: CsCaps = { ...caps, capsVersion: 10, maxGroups: 8 };

// Fixture groups: an input pair (matches PREAMP), an output pair (matches
// OUTPUT_MUTE), an empty slot, a DSP-kind group (matches the DSP_BAND nouns),
// and an input-kind group whose mask lies entirely above PREAMP's targetCount.
const groups: (CsGroup | null)[] = [
  { targetKind: CS_TARGET_INPUT_CH, memberMask: 0b11, name: 'Front Pair' },    // 0
  { targetKind: CS_TARGET_OUTPUT_CH, memberMask: 0b101, name: 'Rear' },        // 1
  null,                                                                        // 2 empty
  { targetKind: CS_TARGET_DSP_CH, memberMask: 0b1000, name: 'Woofer Band' },   // 3
  { targetKind: CS_TARGET_INPUT_CH, memberMask: 0b100, name: 'Out of Range' }, // 4
];

describe('q8.8 conversion', () => {
  it('converts dB to signed 8.8 fixed point per the spec examples', () => {
    expect(dbToQ8(-20)).toBe(-5120);
    expect(dbToQ8(-0.5)).toBe(-128);
    expect(dbToQ8(1)).toBe(256);
    expect(dbToQ8(0)).toBe(0);
  });

  it('round-trips through q8ToDb', () => {
    for (const db of [-127, -60, -12.5, -0.5, 0]) {
      expect(q8ToDb(dbToQ8(db))).toBeCloseTo(db, 6);
    }
  });
});

describe('legalActions', () => {
  it('intersects the type and noun masks in ascending action order', () => {
    // Button (INC/DEC/TOGGLE/SET/TRIGGER/MOMENTARY) on a bool noun (TOGGLE/SET/FOLLOW/MOMENTARY/IND_EQUALS).
    expect(legalActions(0x02BC, 0x0370)).toEqual([CsAction.Toggle, CsAction.Set, CsAction.Momentary]);
    // Encoder (STEP) on an enum noun.
    expect(legalActions(0x0002, 0x012E)).toEqual([CsAction.Step]);
  });

  it('yields an empty set for impossible pairs', () => {
    // Switch (FOLLOW only) driving a continuous noun (no FOLLOW action there).
    expect(legalActions(0x0040, 0x0C2F)).toEqual([]);
    // Encoder (STEP) on a bool noun.
    expect(legalActions(0x0002, 0x0370)).toEqual([]);
  });
});

describe('validateCsBinding', () => {
  const encoderOk = binding({
    type: CsType.Encoder, noun: CsNoun.MasterVolume, action: CsAction.Step,
    gpio0: 21, gpio1: 22, step: 256,
  });

  it('accepts the spec worked examples and the clear binding', () => {
    expect(validateCsBinding(encoderOk, caps, nouns)).toBe(0x00);
    expect(validateCsBinding(binding({
      type: CsType.Led, noun: CsNoun.Loudness, action: CsAction.IndEquals, gpio0: 20, value: 1,
    }), caps, nouns)).toBe(0x00);
    expect(validateCsBinding(EMPTY_CS_BINDING, caps, nouns)).toBe(0x00);
  });

  it('rejects an action outside the type∩noun mask with INVALID_ACTION', () => {
    // Encoder can only STEP; USER_MUTE takes no STEP.
    expect(validateCsBinding(binding({
      type: CsType.Encoder, noun: CsNoun.UserMute, action: CsAction.Step, gpio0: 21, gpio1: 22,
    }), caps, nouns)).toBe(0x13);
    // LED can IND_ABOVE a continuous noun, but not IND_EQUALS it.
    expect(validateCsBinding(binding({
      type: CsType.Led, noun: CsNoun.UserVolume, action: CsAction.IndEquals, gpio0: 20,
    }), caps, nouns)).toBe(0x13);
  });

  it('rejects reserved flag bits and out-of-bounds operands with INVALID_VALUE', () => {
    expect(validateCsBinding({ ...encoderOk, flags: 0x20 }, caps, nouns)).toBe(0x14);
    expect(validateCsBinding({ ...encoderOk, step: -1 }, caps, nouns)).toBe(0x14);
    // SET above the noun ceiling (master volume max is 0 dB).
    expect(validateCsBinding(binding({
      type: CsType.Button, noun: CsNoun.MasterVolume, action: CsAction.Set, gpio0: 20, value: 256,
    }), caps, nouns)).toBe(0x14);
    // Enum SET beyond enum_count.
    expect(validateCsBinding(binding({
      type: CsType.Button, noun: CsNoun.InputSource, action: CsAction.Set, gpio0: 20, value: 3,
    }), caps, nouns)).toBe(0x14);
    // Inverted pot range.
    expect(validateCsBinding(binding({
      type: CsType.Pot, noun: CsNoun.UserVolume, action: CsAction.Adjust,
      gpio0: 26, flags: CS_FLAG_REVERSE, rangeMin: -128, rangeMax: -7680,
    }), caps, nouns)).toBe(0x14);
  });

  it('rejects a pot on a non-ADC pin with PIN_NOT_ADC', () => {
    expect(validateCsBinding(binding({
      type: CsType.Pot, noun: CsNoun.UserVolume, action: CsAction.Adjust, gpio0: 20,
    }), caps, nouns)).toBe(0x15);
  });

  it('rejects an encoder whose two pins are equal with INVALID_PIN', () => {
    expect(validateCsBinding({ ...encoderOk, gpio1: 21 }, caps, nouns)).toBe(0x01);
    expect(validateCsBinding({ ...encoderOk, gpio1: null }, caps, nouns)).toBe(0x01);
  });

  it('rejects a bad or misplaced button event with INVALID_EVENT', () => {
    // Event ordinal past CS_EVT_COUNT.
    expect(validateCsBinding(binding({
      type: CsType.Button, noun: CsNoun.UserMute, action: CsAction.Toggle, gpio0: 20,
      event: 3 as CsEvent,
    }), caps, nouns)).toBe(0x18);
    // A non-button binding must carry event 0.
    expect(validateCsBinding(binding({
      type: CsType.Switch, noun: CsNoun.UserMute, action: CsAction.Follow, gpio0: 20,
      event: CsEvent.Long,
    }), caps, nouns)).toBe(0x18);
    // MOMENTARY only makes sense on the short-press event.
    expect(validateCsBinding(binding({
      type: CsType.Button, noun: CsNoun.UserMute, action: CsAction.Momentary, gpio0: 20,
      event: CsEvent.Long, value: 1,
    }), caps, nouns)).toBe(0x18);
    // A LONG press on the same button is fine.
    expect(validateCsBinding(binding({
      type: CsType.Button, noun: CsNoun.UserMute, action: CsAction.Toggle, gpio0: 20,
      event: CsEvent.Long,
    }), caps, nouns)).toBe(0x00);
  });

  it('rejects REPEAT/ACCEL flags on components that cannot use them', () => {
    // REPEAT only makes sense on a button INC/DEC (SET is otherwise legal here).
    expect(validateCsBinding(binding({
      type: CsType.Button, noun: CsNoun.MasterVolume, action: CsAction.Set, gpio0: 20,
      flags: CS_FLAG_REPEAT,
    }), caps, nouns)).toBe(0x14);
    // ACCEL only makes sense on an encoder.
    expect(validateCsBinding(binding({
      type: CsType.Button, noun: CsNoun.MasterVolume, action: CsAction.Inc, gpio0: 20,
      flags: CS_FLAG_ACCEL,
    }), caps, nouns)).toBe(0x14);
    expect(validateCsBinding({ ...encoderOk, flags: CS_FLAG_ACCEL }, caps, nouns)).toBe(0x00);
  });

  it('rejects a target/index outside the noun addressing with INVALID_TARGET', () => {
    // PREAMP addresses 2 input channels; target 2 is out of range.
    expect(validateCsBinding(binding({
      type: CsType.Button, noun: CsNoun.Preamp, action: CsAction.Set, gpio0: 20,
      target: 2, value: dbToQ8(0),
    }), caps, nouns)).toBe(0x17);
    // An untargeted noun must carry target/index 0.
    expect(validateCsBinding(binding({
      type: CsType.Button, noun: CsNoun.UserMute, action: CsAction.Toggle, gpio0: 20,
      target: 1,
    }), caps, nouns)).toBe(0x17);
  });

  it('enforces Hz and Q bounds as plain-integer / 8.8 raw values per the noun unit', () => {
    // FILTER_FREQ is a plain integer 20..20000 Hz; 25000 is out of range.
    expect(validateCsBinding(binding({
      type: CsType.Button, noun: CsNoun.FilterFreq, action: CsAction.Set, gpio0: 20,
      target: 0, value: 25000,
    }), caps, nouns)).toBe(0x14);
    expect(validateCsBinding(binding({
      type: CsType.Button, noun: CsNoun.FilterFreq, action: CsAction.Set, gpio0: 20,
      target: 0, value: 1000,
    }), caps, nouns)).toBe(0x00);
    // FILTER_Q is 8.8 fixed point 0.1..10 (26..2560 raw); 3000 is out of range.
    expect(validateCsBinding(binding({
      type: CsType.Button, noun: CsNoun.FilterQ, action: CsAction.Set, gpio0: 20,
      target: 0, value: 3000,
    }), caps, nouns)).toBe(0x14);
    expect(validateCsBinding(binding({
      type: CsType.Button, noun: CsNoun.FilterQ, action: CsAction.Set, gpio0: 20,
      target: 0, value: 512,
    }), caps, nouns)).toBe(0x00);
  });

  it('validates the IR container binding: only the receiver pin and INVERT are payload', () => {
    expect(validateCsBinding(binding({ type: CsType.Ir, gpio0: 15 }), caps, nouns)).toBe(0x00);
    expect(validateCsBinding(binding({ type: CsType.Ir, gpio0: 15, flags: 0x02 }), caps, nouns)).toBe(0x14);
    expect(validateCsBinding(binding({
      type: CsType.Ir, gpio0: 15, noun: CsNoun.UserMute, action: CsAction.Toggle,
    }), caps, nouns)).toBe(0x14);
  });

  it('accepts indicator on/off delays only on LED/LED_PWM IND_EQUALS/IND_ABOVE at caps >= 8', () => {
    const caps8 = { ...caps, capsVersion: 8 };
    expect(validateCsBinding(binding({
      type: CsType.Led, noun: CsNoun.UserVolume, action: CsAction.IndAbove, gpio0: 20, value: 0, onDelay: 10,
    }), caps8, nouns)).toBe(0x00);
    // IND_LEVEL isn't a delayable action even on an LED-family type.
    expect(validateCsBinding(binding({
      type: CsType.Led, noun: CsNoun.UserVolume, action: CsAction.IndLevel, gpio0: 20, onDelay: 10,
    }), caps8, nouns)).toBe(0x14);
    // A button is never delayable, regardless of action.
    expect(validateCsBinding(binding({
      type: CsType.Button, noun: CsNoun.UserMute, action: CsAction.Toggle, gpio0: 20, offDelay: 10,
    }), caps8, nouns)).toBe(0x14);
    // Pre-v8 firmware treats the delay bytes as reserved.
    expect(validateCsBinding(binding({
      type: CsType.Led, noun: CsNoun.UserVolume, action: CsAction.IndAbove, gpio0: 20, value: 0, onDelay: 10,
    }), { ...caps, capsVersion: 7 }, nouns)).toBe(0x14);
  });

  it('accepts a brightness ceiling only on LED_PWM at caps >= 12', () => {
    const caps12 = { ...caps, capsVersion: 12 };
    expect(validateCsBinding(binding({
      type: CsType.LedPwm, noun: CsNoun.Loudness, action: CsAction.IndEquals, gpio0: 20, value: 1, baseBright: 40,
    }), caps12, nouns)).toBe(0x00);
    // Wrong type: LED (not LED_PWM) can't carry a ceiling.
    expect(validateCsBinding(binding({
      type: CsType.Led, noun: CsNoun.Loudness, action: CsAction.IndEquals, gpio0: 20, value: 1, baseBright: 40,
    }), caps12, nouns)).toBe(0x14);
    // Out of the 1-100 percent range.
    expect(validateCsBinding(binding({
      type: CsType.LedPwm, noun: CsNoun.Loudness, action: CsAction.IndEquals, gpio0: 20, value: 1, baseBright: 101,
    }), caps12, nouns)).toBe(0x14);
    // Pre-v12 firmware treats the byte as reserved.
    expect(validateCsBinding(binding({
      type: CsType.LedPwm, noun: CsNoun.Loudness, action: CsAction.IndEquals, gpio0: 20, value: 1, baseBright: 40,
    }), { ...caps, capsVersion: 11 }, nouns)).toBe(0x14);
  });

  it('rejects a non-zero reserved2 byte', () => {
    expect(validateCsBinding({ ...encoderOk, reserved2: [1, 0] }, caps, nouns)).toBe(0x14);
    expect(validateCsBinding({ ...encoderOk, reserved2: [0, 0] }, caps, nouns)).toBe(0x00);
  });
});

describe('validateCsGroup', () => {
  const counts = { inputs: 2, outputs: 9, dsp: 11 };

  it('accepts a cleared slot; rejects a non-empty mask or name on an empty slot', () => {
    expect(validateCsGroup(EMPTY_CS_GROUP, counts)).toBe(0x00);
    expect(validateCsGroup({ targetKind: CS_TARGET_NONE, memberMask: 1, name: '' }, counts)).toBe(0x14);
    expect(validateCsGroup({ targetKind: CS_TARGET_NONE, memberMask: 0, name: 'x' }, counts)).toBe(0x14);
  });

  it('rejects an unrecognized kind', () => {
    expect(validateCsGroup({ targetKind: 4, memberMask: 1, name: '' }, counts)).toBe(0x1F);
  });

  it('rejects an empty mask', () => {
    expect(validateCsGroup({ targetKind: CS_TARGET_INPUT_CH, memberMask: 0, name: '' }, counts)).toBe(0x1F);
  });

  it('rejects a mask bit at/above the kind channel count', () => {
    // inputs = 2: bit 2 is out of range.
    expect(validateCsGroup({ targetKind: CS_TARGET_INPUT_CH, memberMask: 0b100, name: '' }, counts)).toBe(0x1F);
  });

  it('accepts a DSP-kind mask bit at the first output index', () => {
    expect(validateCsGroup({
      targetKind: CS_TARGET_DSP_CH, memberMask: 1 << counts.inputs, name: 'Outputs',
    }, counts)).toBe(0x00);
  });
});

describe('validateCsBinding — grouped targets (caps v9+)', () => {
  function grouped(over: Partial<CsBinding>): CsBinding {
    return binding({ flags: CS_FLAG_GROUP, ...over });
  }

  it('accepts a targeted noun bound to a matching-kind group', () => {
    expect(validateCsBinding(grouped({
      type: CsType.Button, noun: CsNoun.Preamp, action: CsAction.Set, gpio0: 20, target: 0, value: dbToQ8(0),
    }), capsV9, nouns, groups)).toBe(0x00);
  });

  it('rejects a group of the wrong kind for the noun', () => {
    expect(validateCsBinding(grouped({
      type: CsType.Button, noun: CsNoun.Preamp, action: CsAction.Set, gpio0: 20, target: 1, value: dbToQ8(0),
    }), capsV9, nouns, groups)).toBe(0x1F);
  });

  it('rejects an empty group slot', () => {
    expect(validateCsBinding(grouped({
      type: CsType.Button, noun: CsNoun.Preamp, action: CsAction.Set, gpio0: 20, target: 2, value: dbToQ8(0),
    }), capsV9, nouns, groups)).toBe(0x1F);
  });

  it('rejects a group index at/above CS_MAX_GROUPS', () => {
    expect(validateCsBinding(grouped({
      type: CsType.Button, noun: CsNoun.Preamp, action: CsAction.Set, gpio0: 20, target: 8, value: dbToQ8(0),
    }), capsV9, nouns, groups)).toBe(0x1F);
  });

  it("rejects a group whose mask lies wholly above the noun's targetCount", () => {
    expect(validateCsBinding(grouped({
      type: CsType.Button, noun: CsNoun.Preamp, action: CsAction.Set, gpio0: 20, target: 4, value: dbToQ8(0),
    }), capsV9, nouns, groups)).toBe(0x1F);
  });

  it('rejects the group flags at a pre-v9 caps version', () => {
    expect(validateCsBinding(grouped({
      type: CsType.Button, noun: CsNoun.Preamp, action: CsAction.Set, gpio0: 20, target: 0, value: dbToQ8(0),
    }), caps, nouns, groups)).toBe(0x14);
  });

  it('accepts a DSP_BAND noun grouped over a DSP-kind group, rejects an input-kind one', () => {
    expect(validateCsBinding(grouped({
      type: CsType.Button, noun: CsNoun.FilterFreq, action: CsAction.Set, gpio0: 20, target: 3, value: 1000,
    }), capsV9, nouns, groups)).toBe(0x00);
    expect(validateCsBinding(grouped({
      type: CsType.Button, noun: CsNoun.FilterFreq, action: CsAction.Set, gpio0: 20, target: 0, value: 1000,
    }), capsV9, nouns, groups)).toBe(0x1F);
  });

  it('rejects LINK_ABS without GROUP', () => {
    expect(validateCsBinding(binding({
      type: CsType.Pot, noun: CsNoun.Preamp, action: CsAction.Adjust, gpio0: 26, flags: CS_FLAG_LINK_ABS,
    }), capsV9, nouns, groups)).toBe(0x14);
  });

  it('rejects LINK_ABS on an encoder STEP', () => {
    expect(validateCsBinding(grouped({
      type: CsType.Encoder, noun: CsNoun.MasterVolume, action: CsAction.Step, gpio0: 21, gpio1: 22, step: 256,
      flags: CS_FLAG_GROUP | CS_FLAG_LINK_ABS, target: 0,
    }), capsV9, nouns, groups)).toBe(0x14);
  });

  it('accepts LINK_ABS on a pot ADJUST', () => {
    expect(validateCsBinding(grouped({
      type: CsType.Pot, noun: CsNoun.Preamp, action: CsAction.Adjust, gpio0: 26,
      flags: CS_FLAG_GROUP | CS_FLAG_LINK_ABS, target: 0,
    }), capsV9, nouns, groups)).toBe(0x00);
  });

  it('rejects GROUP_ALL on a button TOGGLE', () => {
    expect(validateCsBinding(grouped({
      type: CsType.Button, noun: CsNoun.UserMute, action: CsAction.Toggle, gpio0: 20,
      flags: CS_FLAG_GROUP | CS_FLAG_GROUP_ALL, target: 0,
    }), capsV9, nouns, groups)).toBe(0x14);
  });

  it('accepts GROUP_ALL on an LED IND_EQUALS', () => {
    expect(validateCsBinding(grouped({
      type: CsType.Led, noun: CsNoun.OutputMute, action: CsAction.IndEquals, gpio0: 20, value: 1,
      flags: CS_FLAG_GROUP | CS_FLAG_GROUP_ALL, target: 1,
    }), capsV9, nouns, groups)).toBe(0x00);
  });
});

describe('validateCsIrCommand', () => {
  function irCmd(over: Partial<CsIrCommand>): CsIrCommand {
    return { ...EMPTY_CS_IR_COMMAND, ...over };
  }

  it('accepts the cleared (all-zero) command', () => {
    expect(validateCsIrCommand(EMPTY_CS_IR_COMMAND, caps, nouns)).toBe(0x00);
  });

  it('accepts a well-formed occupied command', () => {
    expect(validateCsIrCommand(irCmd({
      noun: CsNoun.MasterVolume, action: CsAction.Inc, protocol: CsIrProto.Nec, code: 0x12345678, step: 256,
    }), caps, nouns)).toBe(0x00);
  });

  it('rejects an action outside the IR button subset with INVALID_ACTION', () => {
    // ADJUST is legal for MASTER_VOLUME, but not for an IR command.
    expect(validateCsIrCommand(irCmd({
      noun: CsNoun.MasterVolume, action: CsAction.Adjust, protocol: CsIrProto.Nec, code: 1,
    }), caps, nouns)).toBe(0x13);
  });

  it('rejects an occupied slot with code 0 (never learned) with INVALID_VALUE', () => {
    expect(validateCsIrCommand(irCmd({
      noun: CsNoun.UserMute, action: CsAction.Toggle, protocol: CsIrProto.Nec, code: 0,
    }), caps, nouns)).toBe(0x14);
  });

  it('rejects a flag bit an IR command may not carry with INVALID_VALUE', () => {
    // CS_FLAG_REVERSE only makes sense on a pot/encoder, not an IR command.
    expect(validateCsIrCommand(irCmd({
      noun: CsNoun.UserMute, action: CsAction.Toggle, protocol: CsIrProto.Nec, code: 1, flags: CS_FLAG_REVERSE,
    }), caps, nouns)).toBe(0x14);
  });

  it('rejects REPEAT on an action other than INC/DEC with INVALID_VALUE', () => {
    expect(validateCsIrCommand(irCmd({
      noun: CsNoun.UserMute, action: CsAction.Toggle, protocol: CsIrProto.Nec, code: 1, flags: CS_FLAG_REPEAT,
    }), caps, nouns)).toBe(0x14);
  });

  it('accepts REPEAT on INC/DEC', () => {
    expect(validateCsIrCommand(irCmd({
      noun: CsNoun.MasterVolume, action: CsAction.Inc, protocol: CsIrProto.Nec, code: 1, flags: CS_FLAG_REPEAT, step: 256,
    }), caps, nouns)).toBe(0x00);
  });

  it('rejects a non-zero remainder on an otherwise-empty (protocol NONE) command', () => {
    expect(validateCsIrCommand(irCmd({ code: 123 }), caps, nouns)).toBe(0x14);
  });

  it('rejects an unrecognized protocol byte', () => {
    expect(validateCsIrCommand(irCmd({
      noun: CsNoun.UserMute, action: CsAction.Toggle, protocol: 5 as CsIrProto, code: 1,
    }), caps, nouns)).toBe(0x14);
  });

  it('accepts a grouped target at caps v10, rejects the GROUP flag at caps v9', () => {
    const cmd = irCmd({
      noun: CsNoun.Preamp, action: CsAction.Inc, protocol: CsIrProto.Nec, code: 1,
      flags: CS_FLAG_GROUP, target: 0,
    });
    expect(validateCsIrCommand(cmd, capsV10, nouns, groups)).toBe(0x00);
    expect(validateCsIrCommand(cmd, capsV9, nouns, groups)).toBe(0x14);
  });

  it('rejects LINK_ABS at any version -- it never applies to an IR command', () => {
    const cmd = irCmd({
      noun: CsNoun.Preamp, action: CsAction.Inc, protocol: CsIrProto.Nec, code: 1, flags: CS_FLAG_LINK_ABS,
    });
    expect(validateCsIrCommand(cmd, capsV10, nouns, groups)).toBe(0x14);
  });
});

describe('liveCsPinConfigs', () => {
  const bindings: (CsBinding | null)[] = [
    binding({ type: CsType.Encoder, noun: CsNoun.MasterVolume, action: CsAction.Step, gpio0: 21, gpio1: 22 }),
    null,
    binding({ type: CsType.Led, noun: CsNoun.Loudness, action: CsAction.IndEquals, gpio0: 20, gpio1: null }),
  ];

  it('projects only live slots (active_mask) into pin reservations', () => {
    // Slot 0 live, slot 2 stored but down (boot pin conflict).
    const status: CsStatus = {
      lastStatus: 0, lastSlot: 0, maxBindings: 16, dirty: false, activeMask: 0b001,
      slotStatus: [0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      irActiveMask: 0, irLearnState: 0, irCmdStatus: [0, 0, 0, 0, 0, 0, 0, 0],
    };
    expect(liveCsPinConfigs(bindings, status)).toEqual([
      { gpio0: 21, gpio1: 22 },
      null,
      null,
    ]);
  });

  it('reserves nothing without a status packet', () => {
    expect(liveCsPinConfigs(bindings, null)).toEqual([null, null, null]);
  });
});
