// Firmware caps-v3 tables as TEST INPUTS (the console itself reads them from
// the device at connect; see GetCsCaps). Shared across the Control Surfaces
// test suites -- only the nouns exercised by at least one suite are filled
// in with real values; the rest are inert placeholders (disabledNoun).
import {
  CsKind,
  CS_UNIT_NONE, CS_UNIT_DB, CS_UNIT_HZ, CS_UNIT_Q,
  CS_TARGET_NONE, CS_TARGET_INPUT_CH, CS_TARGET_OUTPUT_CH, CS_TARGET_DSP_BAND,
  type CsCaps, type CsNounCaps,
} from '@/domain';

export const csCapsV3: CsCaps = {
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

export const disabledNoun: CsNounCaps = {
  kind: CsKind.Bool, enumCount: 0, actions: 0, minQ8: 0, maxQ8: 0,
  unit: CS_UNIT_NONE, targetKind: CS_TARGET_NONE, targetCount: 0, dflags: 0,
};

// Real wire-indexed noun caps (0..22), the fullest caps-v3 table exercised
// by any suite. controlSurfaces.test.ts shows how later caps versions
// extend it (groups, macros, display nouns); other suites pick individual
// entries out of this table by CsNoun index rather than retyping them.
export const csNouns: CsNounCaps[] = [
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
