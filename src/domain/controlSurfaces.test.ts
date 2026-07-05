import { describe, it, expect } from 'vitest';
import {
  CsType, CsNoun, CsAction, CsKind,
  CS_FLAG_REVERSE,
  dbToQ8, q8ToDb, legalActions, validateCsBinding, liveCsPinConfigs,
  EMPTY_CS_BINDING,
  type CsBinding, type CsCaps, type CsNounCaps, type CsStatus,
} from './controlSurfaces';

// Firmware caps-v1 tables as TEST INPUTS (the console itself reads them from
// the device at connect; see GetCsCaps).
const caps: CsCaps = {
  capsVersion: 1,
  maxBindings: 8,
  types: [
    { actions: 0x0000, pinCount: 0, pinClass: 0 },
    { actions: 0x00BC, pinCount: 1, pinClass: 0 },   // BUTTON
    { actions: 0x0040, pinCount: 1, pinClass: 0 },   // SWITCH
    { actions: 0x0001, pinCount: 1, pinClass: 1 },   // POT (ADC)
    { actions: 0x0002, pinCount: 2, pinClass: 0 },   // ENCODER
    { actions: 0x0100, pinCount: 1, pinClass: 0 },   // LED
  ],
};

const nouns: CsNounCaps[] = [
  { kind: CsKind.Continuous, enumCount: 0,  actions: 0x002F, minQ8: -15360, maxQ8: 0 },
  { kind: CsKind.Continuous, enumCount: 0,  actions: 0x002F, minQ8: -32512, maxQ8: 0 },
  { kind: CsKind.Bool,       enumCount: 0,  actions: 0x0170, minQ8: 0, maxQ8: 0 },
  { kind: CsKind.Bool,       enumCount: 0,  actions: 0x0170, minQ8: 0, maxQ8: 0 },
  { kind: CsKind.Bool,       enumCount: 0,  actions: 0x0170, minQ8: 0, maxQ8: 0 },
  { kind: CsKind.Bool,       enumCount: 0,  actions: 0x0170, minQ8: 0, maxQ8: 0 },
  { kind: CsKind.Enum,       enumCount: 10, actions: 0x012E, minQ8: 0, maxQ8: 0 },
  { kind: CsKind.Enum,       enumCount: 3,  actions: 0x012E, minQ8: 0, maxQ8: 0 },
  { kind: CsKind.Bool,       enumCount: 0,  actions: 0x0180, minQ8: 0, maxQ8: 0 },
];

function binding(over: Partial<CsBinding>): CsBinding {
  return { ...EMPTY_CS_BINDING, ...over };
}

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
    // Button (INC/DEC/TOGGLE/SET/TRIGGER) on a bool noun (TOGGLE/SET/FOLLOW/IND).
    expect(legalActions(0x00BC, 0x0170)).toEqual([CsAction.Toggle, CsAction.Set]);
    // Encoder (STEP) on an enum noun.
    expect(legalActions(0x0002, 0x012E)).toEqual([CsAction.Step]);
  });

  it('yields an empty set for impossible pairs', () => {
    // LED (IND_EQUALS only) driving user volume (control actions only).
    expect(legalActions(0x0100, 0x002F)).toEqual([]);
    // Encoder (STEP) on a bool noun.
    expect(legalActions(0x0002, 0x0170)).toEqual([]);
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
    // LED on a volume noun: empty intersection.
    expect(validateCsBinding(binding({
      type: CsType.Led, noun: CsNoun.UserVolume, action: CsAction.IndEquals, gpio0: 20,
    }), caps, nouns)).toBe(0x13);
  });

  it('rejects reserved flag bits and out-of-bounds operands with INVALID_VALUE', () => {
    expect(validateCsBinding({ ...encoderOk, flags: 0x08 }, caps, nouns)).toBe(0x14);
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
});

describe('liveCsPinConfigs', () => {
  const bindings: (CsBinding | null)[] = [
    binding({ type: CsType.Encoder, noun: CsNoun.MasterVolume, action: CsAction.Step, gpio0: 21, gpio1: 22 }),
    null,
    binding({ type: CsType.Led, noun: CsNoun.Loudness, action: CsAction.IndEquals, gpio0: 20, gpio1: null }),
  ];

  it('projects only live slots (active_mask) into pin reservations', () => {
    // Slot 0 live, slot 2 stored but down (boot pin conflict).
    const status: CsStatus = { lastStatus: 0, lastSlot: 0, maxBindings: 8, activeMask: 0b001, slotStatus: [0, 0, 2, 0, 0, 0, 0, 0] };
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
