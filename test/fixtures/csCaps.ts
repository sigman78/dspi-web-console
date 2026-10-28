// Firmware caps-v3 tables as TEST INPUTS (the console itself reads them from
// the device at connect; see GetCsCaps). Shared across the Control Surfaces
// test suites -- only the nouns exercised by at least one suite are filled
// in with real values; the rest are inert placeholders (disabledNoun).
import * as Domain from '@/domain';
import type { CsCaps, CsNounCaps } from '@/domain';

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
  kind: Domain.CsKind.Bool, enumCount: 0, actions: 0, minQ8: 0, maxQ8: 0,
  unit: Domain.CS_UNIT_NONE, targetKind: Domain.CS_TARGET_NONE, targetCount: 0, dflags: 0,
};

// Real wire-indexed noun caps (0..22), the fullest caps-v3 table exercised
// by any suite. controlSurfaces.test.ts shows how later caps versions
// extend it (groups, macros, display nouns); other suites pick individual
// entries out of this table by CsNoun index rather than retyping them.
export const csNouns: CsNounCaps[] = [
  { kind: Domain.CsKind.Continuous, enumCount: 0, actions: 0x0C2F, minQ8: -15360, maxQ8: 0,
    unit: Domain.CS_UNIT_DB, targetKind: Domain.CS_TARGET_NONE, targetCount: 0, dflags: 0 },       // 0  USER_VOLUME
  { kind: Domain.CsKind.Continuous, enumCount: 0, actions: 0x0C2F, minQ8: -32512, maxQ8: 0,
    unit: Domain.CS_UNIT_DB, targetKind: Domain.CS_TARGET_NONE, targetCount: 0, dflags: 0 },       // 1  MASTER_VOLUME
  { kind: Domain.CsKind.Bool, enumCount: 0, actions: 0x0370, minQ8: 0, maxQ8: 0,
    unit: Domain.CS_UNIT_NONE, targetKind: Domain.CS_TARGET_NONE, targetCount: 0, dflags: 0 },     // 2  USER_MUTE
  { kind: Domain.CsKind.Bool, enumCount: 0, actions: 0x0370, minQ8: 0, maxQ8: 0,
    unit: Domain.CS_UNIT_NONE, targetKind: Domain.CS_TARGET_NONE, targetCount: 0, dflags: 0 },     // 3  LOUDNESS
  { kind: Domain.CsKind.Bool, enumCount: 0, actions: 0x0370, minQ8: 0, maxQ8: 0,
    unit: Domain.CS_UNIT_NONE, targetKind: Domain.CS_TARGET_NONE, targetCount: 0, dflags: 0 },     // 4  CROSSFEED
  { kind: Domain.CsKind.Bool, enumCount: 0, actions: 0x0370, minQ8: 0, maxQ8: 0,
    unit: Domain.CS_UNIT_NONE, targetKind: Domain.CS_TARGET_NONE, targetCount: 0, dflags: 0 },     // 5  LEVELLER
  { kind: Domain.CsKind.Enum, enumCount: 10, actions: 0x012E, minQ8: 0, maxQ8: 0,
    unit: Domain.CS_UNIT_NONE, targetKind: Domain.CS_TARGET_NONE, targetCount: 0, dflags: 0 },     // 6  PRESET
  { kind: Domain.CsKind.Enum, enumCount: 3, actions: 0x012E, minQ8: 0, maxQ8: 0,
    unit: Domain.CS_UNIT_NONE, targetKind: Domain.CS_TARGET_NONE, targetCount: 0, dflags: 0 },     // 7  INPUT_SOURCE
  { kind: Domain.CsKind.Bool, enumCount: 0, actions: 0x0180, minQ8: 0, maxQ8: 0,
    unit: Domain.CS_UNIT_NONE, targetKind: Domain.CS_TARGET_NONE, targetCount: 0, dflags: 0 },     // 8  CLIP
  ...Array(7).fill(disabledNoun),                                                    // 9..15 (unused here)
  { kind: Domain.CsKind.Continuous, enumCount: 0, actions: 0x0C2F, minQ8: -6144, maxQ8: 6144,
    unit: Domain.CS_UNIT_DB, targetKind: Domain.CS_TARGET_INPUT_CH, targetCount: 2, dflags: 0 },   // 16 PREAMP
  disabledNoun,                                                                      // 17 (unused here)
  { kind: Domain.CsKind.Bool, enumCount: 0, actions: 0x0370, minQ8: 0, maxQ8: 0,
    unit: Domain.CS_UNIT_NONE, targetKind: Domain.CS_TARGET_OUTPUT_CH, targetCount: 3, dflags: 0 }, // 18 OUTPUT_MUTE
  disabledNoun,                                                                      // 19 (unused here)
  { kind: Domain.CsKind.Continuous, enumCount: 0, actions: 0x0C2F, minQ8: 20, maxQ8: 20000,
    unit: Domain.CS_UNIT_HZ, targetKind: Domain.CS_TARGET_DSP_BAND, targetCount: 7, dflags: 0 },   // 20 FILTER_FREQ
  disabledNoun,                                                                      // 21 (unused here)
  { kind: Domain.CsKind.Continuous, enumCount: 0, actions: 0x0C2F, minQ8: 26, maxQ8: 2560,
    unit: Domain.CS_UNIT_Q, targetKind: Domain.CS_TARGET_DSP_BAND, targetCount: 7, dflags: 0 },    // 22 FILTER_Q
];
