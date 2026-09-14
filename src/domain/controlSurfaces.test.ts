import { describe, it, expect } from 'vitest';
import {
  CsType, CsNoun, CsAction, CsKind, CsEvent, CsIrProto, CsDisplayMode,
  CS_FLAG_REVERSE, CS_FLAG_REPEAT, CS_FLAG_ACCEL,
  CS_FLAG_GROUP, CS_FLAG_LINK_ABS, CS_FLAG_GROUP_ALL,
  CS_UNIT_NONE, CS_UNIT_PERCENT,
  CS_TARGET_NONE, CS_TARGET_INPUT_CH, CS_TARGET_OUTPUT_CH, CS_TARGET_DSP_CH,
  CS_DPAGE_ACTIVE, CS_DPAGE_GROUP, CS_DPAGE_LARGE, CS_DPAGE_BAR,
  dbToQ8, q8ToDb, legalActions, validateCsBinding, validateCsIrCommand, validateCsGroup, liveCsPinConfigs,
  validateCsMacroStep, validateCsMacro, validateCsDisplayCfg, validateCsDisplayPage,
  EMPTY_CS_BINDING, EMPTY_CS_IR_COMMAND, EMPTY_CS_GROUP, EMPTY_CS_MACRO_STEP, EMPTY_CS_DISPLAY_CFG,
  type CsBinding, type CsCaps, type CsNounCaps, type CsStatus, type CsIrCommand, type CsGroup, type CsMacroStep,
  type CsDisplayCfg, type CsDisplayPage,
} from './controlSurfaces';
import { csCapsV3, csNouns, disabledNoun } from '@test/fixtures/csCaps';

const caps: CsCaps = csCapsV3;
const nouns: CsNounCaps[] = csNouns;

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

// caps v9 noun table: the v3 fixture above (0..22) plus 29 disabled
// placeholders (23..51) so CS_NOUN_MACRO lands at its real wire index, 52.
const macroNoun: CsNounCaps = {
  kind: CsKind.Enum, enumCount: 8, actions: (1 << CsAction.Set) | (1 << CsAction.IndEquals),
  minQ8: 0, maxQ8: 0, unit: CS_UNIT_NONE, targetKind: CS_TARGET_NONE, targetCount: 0, dflags: 0,
};
const nounsV9: CsNounCaps[] = [...nouns, ...Array(29).fill(disabledNoun), macroNoun];

// caps v10 additions: nouns 53-56 (CPU_LOAD, DISPLAY_PAGE, DISPLAY_EDIT,
// PAGE_VALUE) and a 9th type row for CS_TYPE_DISPLAY.
const cpuLoadNoun: CsNounCaps = {
  kind: CsKind.Continuous, enumCount: 0, actions: 0x0C00, minQ8: 0, maxQ8: 25600,
  unit: CS_UNIT_PERCENT, targetKind: CS_TARGET_NONE, targetCount: 0, dflags: 0,
};
const displayPageNoun: CsNounCaps = {
  kind: CsKind.Enum, enumCount: 16, actions: 0x012E, minQ8: 0, maxQ8: 0,
  unit: CS_UNIT_NONE, targetKind: CS_TARGET_NONE, targetCount: 0, dflags: 0,
};
const displayEditNoun: CsNounCaps = {
  kind: CsKind.Bool, enumCount: 0, actions: 0x0370, minQ8: 0, maxQ8: 0,
  unit: CS_UNIT_NONE, targetKind: CS_TARGET_NONE, targetCount: 0, dflags: 0,
};
const pageValueNoun: CsNounCaps = {
  kind: CsKind.Enum, enumCount: 1, actions: 0x001E, minQ8: 0, maxQ8: 0,
  unit: CS_UNIT_NONE, targetKind: CS_TARGET_NONE, targetCount: 0, dflags: 0,
};
const nounsV10: CsNounCaps[] = [...nounsV9, cpuLoadNoun, displayPageNoun, displayEditNoun, pageValueNoun];

const capsV10Display: CsCaps = {
  ...caps, capsVersion: 10, maxGroups: 8,
  types: [...caps.types, { actions: 0, pinCount: 2, pinClass: 0 }],
};

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

describe('validateCsMacroStep', () => {
  function macroStep(over: Partial<CsMacroStep>): CsMacroStep {
    return { ...EMPTY_CS_MACRO_STEP, ...over };
  }

  it('accepts the empty (all-zero) step', () => {
    expect(validateCsMacroStep(EMPTY_CS_MACRO_STEP, nounsV9)).toBe(0x00);
  });

  it('rejects the MACRO noun itself with INVALID_STEP (no nesting)', () => {
    expect(validateCsMacroStep(macroStep({ noun: CsNoun.Macro, action: CsAction.Set }), nounsV9)).toBe(0x21);
  });

  it('rejects an action outside the macro step subset with INVALID_STEP', () => {
    expect(validateCsMacroStep(macroStep({
      noun: CsNoun.MasterVolume, action: CsAction.Adjust,
    }), nounsV9)).toBe(0x21);
  });

  it('rejects a flag outside WRAP|GROUP with INVALID_STEP', () => {
    expect(validateCsMacroStep(macroStep({
      noun: CsNoun.Preamp, action: CsAction.Set, flags: CS_FLAG_LINK_ABS, value: dbToQ8(0),
    }), nounsV9)).toBe(0x21);
  });

  it('rejects an action outside the noun mask with INVALID_ACTION', () => {
    // CLIP only takes TRIGGER/IND_EQUALS; SET is not in its mask.
    expect(validateCsMacroStep(macroStep({ noun: CsNoun.Clip, action: CsAction.Set }), nounsV9)).toBe(0x13);
  });

  it('validates a grouped target the same as a binding: matching kind ok, wrong kind INVALID_GROUP', () => {
    const grouped = macroStep({
      noun: CsNoun.Preamp, action: CsAction.Set, flags: CS_FLAG_GROUP, value: dbToQ8(0),
    });
    expect(validateCsMacroStep({ ...grouped, target: 0 }, nounsV9, groups)).toBe(0x00);   // input pair
    expect(validateCsMacroStep({ ...grouped, target: 1 }, nounsV9, groups)).toBe(0x1F);   // output-kind group
  });

  it('rejects a continuous SET value above the noun ceiling with INVALID_VALUE', () => {
    expect(validateCsMacroStep(macroStep({
      noun: CsNoun.Preamp, action: CsAction.Set, target: 0, value: 6145,
    }), nounsV9)).toBe(0x14);
  });

  it('rejects a negative step size on a continuous INC with INVALID_VALUE', () => {
    expect(validateCsMacroStep(macroStep({
      noun: CsNoun.MasterVolume, action: CsAction.Inc, step: -1,
    }), nounsV9)).toBe(0x14);
  });

  it('rejects an enum SET at/above enum_count, accepts the top legal value', () => {
    expect(validateCsMacroStep(macroStep({
      noun: CsNoun.Preset, action: CsAction.Set, value: 10,
    }), nounsV9)).toBe(0x14);
    expect(validateCsMacroStep(macroStep({
      noun: CsNoun.Preset, action: CsAction.Set, value: 9,
    }), nounsV9)).toBe(0x00);
  });

  it('rejects a target at/above the noun addressing with INVALID_TARGET', () => {
    expect(validateCsMacroStep(macroStep({
      noun: CsNoun.OutputMute, action: CsAction.Toggle, target: 2,
    }), nounsV9)).toBe(0x00);
    expect(validateCsMacroStep(macroStep({
      noun: CsNoun.OutputMute, action: CsAction.Toggle, target: 3,
    }), nounsV9)).toBe(0x17);
  });
});

describe('validateCsMacro', () => {
  const okStep: CsMacroStep = { ...EMPTY_CS_MACRO_STEP, noun: CsNoun.OutputMute, action: CsAction.Toggle, target: 0 };
  const badStep: CsMacroStep = {
    ...EMPTY_CS_MACRO_STEP, noun: CsNoun.Preamp, action: CsAction.Set, target: 0, value: 9999,
  };
  const filler = Array.from({ length: 5 }, () => EMPTY_CS_MACRO_STEP);

  it('rejects a step_count above CS_MAX_MACRO_STEPS with INVALID_MACRO', () => {
    const steps = Array.from({ length: 8 }, () => EMPTY_CS_MACRO_STEP);
    expect(validateCsMacro({ name: '', stepCount: 9, steps }, nounsV9)).toBe(0x20);
  });

  it('reports the failing step status when it falls within stepCount', () => {
    const steps = [okStep, badStep, okStep, ...filler];
    expect(validateCsMacro({ name: '', stepCount: 3, steps }, nounsV9)).toBe(0x14);
  });

  it('ignores a bad step beyond stepCount', () => {
    const steps = [okStep, badStep, okStep, ...filler];
    expect(validateCsMacro({ name: '', stepCount: 1, steps }, nounsV9)).toBe(0x00);
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

  it('marks a live display slot for the pin-label helper', () => {
    const displayBindings: (CsBinding | null)[] = [
      binding({ type: CsType.Display, index: 6, gpio0: 4, gpio1: 5 }),
    ];
    const status: CsStatus = {
      lastStatus: 0, lastSlot: 0, maxBindings: 16, dirty: false, activeMask: 0b1,
      slotStatus: [0], irActiveMask: 0, irLearnState: 0, irCmdStatus: [],
    };
    expect(liveCsPinConfigs(displayBindings, status)).toEqual([{ gpio0: 4, gpio1: 5, display: true }]);
  });
});

describe('validateCsBinding — I2C display (caps v10+)', () => {
  function display(over: Partial<CsBinding> = {}): CsBinding {
    return binding({ type: CsType.Display, index: 6, value: 0, gpio0: 4, gpio1: 5, ...over });
  }

  it('accepts a well-formed display binding', () => {
    expect(validateCsBinding(display(), capsV10Display, nounsV10)).toBe(0x00);
  });

  it('rejects model 0 or >= 9 with INVALID_VALUE', () => {
    expect(validateCsBinding(display({ index: 0 }), capsV10Display, nounsV10)).toBe(0x14);
    expect(validateCsBinding(display({ index: 9 }), capsV10Display, nounsV10)).toBe(0x14);
  });

  it('rejects an address override outside 0x08-0x77, accepts one inside it', () => {
    expect(validateCsBinding(display({ value: 0x07 }), capsV10Display, nounsV10)).toBe(0x14);
    expect(validateCsBinding(display({ value: 0x3C }), capsV10Display, nounsV10)).toBe(0x00);
  });

  it('rejects a non-zero noun -- the container payload is model/address only', () => {
    expect(validateCsBinding(display({ noun: 1 }), capsV10Display, nounsV10)).toBe(0x14);
  });

  it('rejects an SDA/SCL pair failing parity or instance with PIN_NOT_I2C', () => {
    expect(validateCsBinding(display({ gpio0: 5, gpio1: 4 }), capsV10Display, nounsV10)).toBe(0x23);
    expect(validateCsBinding(display({ gpio0: 4, gpio1: 7 }), capsV10Display, nounsV10)).toBe(0x23);
  });

  it('accepts a non-adjacent SDA/SCL pair on the same I2C instance', () => {
    expect(validateCsBinding(display({ gpio0: 0, gpio1: 5 }), capsV10Display, nounsV10)).toBe(0x00);
  });

  it("rejects the live control interface's I2C instance with I2C_IN_USE", () => {
    expect(validateCsBinding(display({ gpio0: 4, gpio1: 5 }), capsV10Display, nounsV10, [], 0)).toBe(0x24);
    expect(validateCsBinding(display({ gpio0: 6, gpio1: 7 }), capsV10Display, nounsV10, [], 0)).toBe(0x00);
  });

  it('rejects a missing second pin with INVALID_PIN', () => {
    expect(validateCsBinding(display({ gpio1: null }), capsV10Display, nounsV10)).toBe(0x01);
  });
});

describe('validateCsBinding / validateCsIrCommand — PAGE_VALUE noun (caps v10+)', () => {
  function pageValueButton(over: Partial<CsBinding> = {}): CsBinding {
    return binding({ type: CsType.Button, noun: CsNoun.PageValue, action: CsAction.Inc, gpio0: 20, ...over });
  }

  it('rejects a non-zero step on a binding, accepts a zero one', () => {
    expect(validateCsBinding(pageValueButton({ step: 1 }), capsV10Display, nounsV10)).toBe(0x14);
    expect(validateCsBinding(pageValueButton({ step: 0 }), capsV10Display, nounsV10)).toBe(0x00);
  });

  it('rejects a non-zero target -- PAGE_VALUE is untargeted', () => {
    expect(validateCsBinding(pageValueButton({ target: 1 }), capsV10Display, nounsV10)).toBe(0x17);
  });
});

describe('validateCsDisplayCfg', () => {
  function cfg(over: Partial<CsDisplayCfg> = {}): CsDisplayCfg {
    return { ...EMPTY_CS_DISPLAY_CFG, ...over };
  }

  it('accepts the all-zero cfg', () => {
    expect(validateCsDisplayCfg(EMPTY_CS_DISPLAY_CFG)).toBe(0x00);
  });

  it('rejects a mode above CYCLE_ALL', () => {
    expect(validateCsDisplayCfg(cfg({ mode: 3 as CsDisplayMode }))).toBe(0x14);
  });

  it('rejects a home page at/above CS_MAX_DISPLAY_PAGES with INVALID_PAGE', () => {
    expect(validateCsDisplayCfg(cfg({ homePage: 16 }))).toBe(0x25);
  });

  it('rejects unknown flag bits', () => {
    expect(validateCsDisplayCfg(cfg({ flags: 0x40 }))).toBe(0x14);
  });

  it('rejects an alignment field of 3 (reserved)', () => {
    expect(validateCsDisplayCfg(cfg({ flags: 0x0C }))).toBe(0x14);   // label align bits = 3
  });

  it('requires dwell >= 10 outside FIXED mode, but not inside it', () => {
    expect(validateCsDisplayCfg(cfg({ mode: CsDisplayMode.CycleSelected, dwell: 9 }))).toBe(0x14);
    expect(validateCsDisplayCfg(cfg({ mode: CsDisplayMode.CycleSelected, dwell: 10 }))).toBe(0x00);
    expect(validateCsDisplayCfg(cfg({ mode: CsDisplayMode.Fixed, dwell: 0 }))).toBe(0x00);
  });
});

describe('validateCsDisplayPage', () => {
  function page(over: Partial<CsDisplayPage> = {}): CsDisplayPage {
    return { noun: CsNoun.UserVolume, target: 0, index: 0, flags: CS_DPAGE_ACTIVE, ...over };
  }
  // CLIP's actions read 0 here, standing in for a noun disabled on this
  // platform build (mirrors the RP2040 ADAT_ACTIVE / upmix gating).
  const nounsNoClip = nounsV10.map((n, i) => (i === CsNoun.Clip ? disabledNoun : n));

  it('rejects a non-ACTIVE page carrying any other non-zero field', () => {
    expect(validateCsDisplayPage({ noun: 0, target: 0, index: 0, flags: CS_DPAGE_LARGE }, nounsV10, groups)).toBe(0x25);
    expect(validateCsDisplayPage({ noun: 0, target: 0, index: 0, flags: 0x10 }, nounsV10, groups)).toBe(0x25);
  });

  it('accepts the all-zero (empty) page', () => {
    expect(validateCsDisplayPage({ noun: 0, target: 0, index: 0, flags: 0 }, nounsV10, groups)).toBe(0x00);
  });

  it('rejects BAR on an enum noun, accepts it on a continuous one', () => {
    expect(validateCsDisplayPage(page({ noun: CsNoun.Preset, flags: CS_DPAGE_ACTIVE | CS_DPAGE_BAR }), nounsV10, groups)).toBe(0x25);
    expect(validateCsDisplayPage(page({ noun: CsNoun.Preamp, flags: CS_DPAGE_ACTIVE | CS_DPAGE_BAR }), nounsV10, groups)).toBe(0x00);
  });

  it('rejects a display noun as a page (no recursing into the display from itself)', () => {
    expect(validateCsDisplayPage(page({ noun: CsNoun.DisplayEdit }), nounsV10, groups)).toBe(0x25);
  });

  it('rejects a platform-unavailable noun (actions == 0) with INVALID_NOUN', () => {
    expect(validateCsDisplayPage(page({ noun: CsNoun.Clip }), nounsNoClip, groups)).toBe(0x12);
  });

  it('rejects a group of the wrong kind for the noun with INVALID_GROUP', () => {
    expect(validateCsDisplayPage(page({ noun: CsNoun.Preamp, flags: CS_DPAGE_ACTIVE | CS_DPAGE_GROUP, target: 1 }), nounsV10, groups)).toBe(0x1F);
  });

  it('rejects a non-zero target on an untargeted noun with INVALID_TARGET', () => {
    expect(validateCsDisplayPage(page({ noun: CsNoun.MasterVolume, target: 1 }), nounsV10, groups)).toBe(0x17);
  });

  it('bounds a targeted noun against its own target count', () => {
    expect(validateCsDisplayPage(page({ noun: CsNoun.OutputMute, target: 3 }), nounsV10, groups)).toBe(0x17);
    expect(validateCsDisplayPage(page({ noun: CsNoun.OutputMute, target: 2 }), nounsV10, groups)).toBe(0x00);
  });
});
