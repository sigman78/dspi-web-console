// Control Surfaces (fw 1.1.5+, wire V16+, caps v2-v8 modeled plus v12's
// base_bright): user-wired physical controls and indicators (buttons,
// switches, pots, encoders, LEDs, PWM LEDs, an IR remote receiver) on spare
// GPIOs, configured over vendor commands 0x84-0x8F, 0x9D-0x9E. Which (type,
// noun, action) combinations are legal comes from the device-served caps
// tables read at connect (GetCsCaps), never from hardcoded masks; this module
// holds the wire enums, q8.8 helpers, UI labels, and the client-side
// pre-validation that mirrors the firmware's own check order.
//
// Binding and slot-name SETs are live-only previews: CS_SAVE persists the
// whole live config to flash, CS_REVERT discards the preview and re-applies
// the stored one. `CsStatus.dirty` reports whether the two differ. IR
// commands (sub-slots of the single IR container binding) follow the same
// preview/save/revert model.

import { i2cInstance } from './controlInterfaces';

export const CsType = {
  None:    0,
  Button:  1,
  Switch:  2,
  Pot:     3,
  Encoder: 4,
  Led:     5,
  LedPwm:  6,
  Ir:      7,
  Display: 8,
} as const;
export type CsType = (typeof CsType)[keyof typeof CsType];

// Component types this console can edit.
export const CS_MAX_KNOWN_TYPE: number = CsType.Display;

export const CsNoun = {
  UserVolume:         0,
  MasterVolume:       1,
  UserMute:           2,
  Loudness:           3,
  Crossfeed:          4,
  Leveller:           5,
  Preset:             6,
  InputSource:        7,
  Clip:               8,
  EqBypass:           9,
  LgSync:             10,
  CrossfeedPreset:    11,
  CrossfeedItd:       12,
  LevellerAmount:     13,
  LevellerSpeed:      14,
  LevellerLookahead:  15,
  Preamp:             16,
  OutputGain:         17,
  OutputMute:         18,
  OutputEnable:       19,
  FilterFreq:         20,
  FilterGain:         21,
  FilterQ:            22,
  FilterType:         23,
  FilterBypass:       24,
  Siggen:             25,
  DacMuteTest:        26,
  ClipCh:             27,
  Level:              28,
  SpdifLock:          29,
  SampleRate:         30,
  UsbStreaming:       31,
  AdatActive:         32,
  LgPresent:          33,
  LgMuted:            34,
  // caps v4 additions. Upmix nouns are RP2350-only: their action masks read 0
  // on RP2040 (same convention as AdatActive), so the pickers hide them.
  Upmix:              35,
  UpmixCenterMode:    36,
  UpmixSurroundMode:  37,
  UpmixStrength:      38,
  UpmixWidth:         39,
  UpmixPresence:      40,
  Psybass:            41,
  PsybassCutoff:      42,
  PsybassHarmonics:   43,
  PsybassDrive:       44,
  PsybassCharacter:   45,
  PsybassOriginal:    46,
  OutputDelay:        47,
  PresetReload:       48,
  // caps v7 additions.
  LoudnessSpl:        49,
  LoudnessIntensity:  50,
  // caps v8 addition. Read-only, IND actions only, untargeted.
  InputLevelMax:      51,
  // caps v9 addition. SET fires the macro `value`; IND_EQUALS lights while it
  // runs. INC/DEC are deliberately excluded (stepping would fire while browsing).
  Macro:              52,
  // caps v10 additions: I2C display support. CpuLoad is untargeted, LED-only.
  // DisplayPage/DisplayEdit browse and arm a display's front panel; PageValue
  // steps/toggles whatever field the display currently has focused -- a
  // macro step must reject it (no nesting).
  CpuLoad:            53,
  DisplayPage:        54,
  DisplayEdit:        55,
  PageValue:          56,
  // caps v14 additions. Both platforms -- unlike the upmix nouns above there
  // is no RP2350 gate on the subharmonic synthesizer.
  Subharm:            57,
  SubharmLow:         58,
  SubharmHigh:        59,
  SubharmBoost:       60,
} as const;
export type CsNoun = (typeof CsNoun)[keyof typeof CsNoun];

export const CsAction = {
  Adjust:    0,
  Step:      1,
  Inc:       2,
  Dec:       3,
  Toggle:    4,
  Set:       5,
  Follow:    6,
  Trigger:   7,
  IndEquals: 8,
  Momentary: 9,
  IndAbove:  10,
  IndLevel:  11,
} as const;
export type CsAction = (typeof CsAction)[keyof typeof CsAction];

const CS_ACTION_COUNT = Object.keys(CsAction).length;

// Button events (CsBinding.event; CS_TYPE_BUTTON only, 0 for other types).
// Bindings of button type may share one GPIO when their events differ.
export const CsEvent = {
  Press:  0,
  Long:   1,
  Double: 2,
} as const;
export type CsEvent = (typeof CsEvent)[keyof typeof CsEvent];

const CS_EVENT_COUNT = Object.keys(CsEvent).length;

export const CsKind = {
  Continuous: 0,
  Bool:       1,
  Enum:       2,
} as const;
export type CsKind = (typeof CsKind)[keyof typeof CsKind];

// IrCommand.protocol; NONE marks an empty sub-slot. A host treats
// protocol+code as an opaque pair -- see control_surfaces_spec.md 2.7 for the
// per-protocol code encodings.
export const CsIrProto = {
  None: 0,
  Nec:  1,
  Rc5:  2,
  Rc6:  3,
  Hash: 4,
} as const;
export type CsIrProto = (typeof CsIrProto)[keyof typeof CsIrProto];

// The button-shaped action subset an IrCommand may carry (section 2.7):
// everything except the pot/encoder/indicator-only actions.
const CS_IR_BUTTON_ACTIONS =
  (1 << CsAction.Inc) | (1 << CsAction.Dec) | (1 << CsAction.Toggle) |
  (1 << CsAction.Set) | (1 << CsAction.Trigger) | (1 << CsAction.Momentary);

export const CS_FLAG_INVERT  = 0x01;
export const CS_FLAG_REVERSE = 0x02;
export const CS_FLAG_WRAP    = 0x04;
export const CS_FLAG_ACCEL   = 0x08;  // encoder: fast rotation multiplies the step
export const CS_FLAG_REPEAT  = 0x10;  // button INC/DEC: auto-repeat while held
// caps v9+ group flags (below). `target` is a group index when GROUP is set.
export const CS_FLAG_GROUP     = 0x20;  // target is a group index, not a channel
export const CS_FLAG_LINK_ABS  = 0x40;  // grouped pot ADJUST: drive every member to the same value
export const CS_FLAG_GROUP_ALL = 0x80;  // grouped IND_EQUALS/IND_ABOVE: AND instead of OR
export const CS_GROUP_FLAGS  = CS_FLAG_GROUP | CS_FLAG_LINK_ABS | CS_FLAG_GROUP_ALL;
export const CS_KNOWN_FLAGS  = CS_FLAG_INVERT | CS_FLAG_REVERSE | CS_FLAG_WRAP | CS_FLAG_ACCEL | CS_FLAG_REPEAT | CS_GROUP_FLAGS;

export const CS_MAX_BINDINGS = 16;
export const CS_MAX_GROUPS   = 8;
export const CS_MAX_MACROS      = 8;
export const CS_MAX_MACRO_STEPS = 8;
export const CS_GPIO_UNUSED  = 0xFF;
export const CS_NAME_MAX_LEN = 31;   // bytes, UTF-8 (32-byte NUL-terminated window)

// fw caps v6+: CS_MAX_IR_COMMANDS grew 8 -> 16. Pre-v6 devices report 8 via
// caps.maxIrCommands; every host loop sizes from caps, not this constant.
export const CS_MAX_IR_COMMANDS = 16;

// GetCsStatus.irLearnState / the CsIrLearn(wValue=2) result read.
export const CS_IR_LEARN_IDLE    = 0;
export const CS_IR_LEARN_ARMED   = 1;
export const CS_IR_LEARN_DONE    = 2;
export const CS_IR_LEARN_TIMEOUT = 3;

export const CS_PINCLASS_ADC = 1;

// Value units (CsNounDesc.unit). Fixes both the wire encoding of
// value/range_min/range_max and the stepping law (see the q8.8 helpers below).
export const CS_UNIT_NONE    = 0;   // bool/enum: plain integers
export const CS_UNIT_DB      = 1;   // 8.8 signed dB; linear stepping
export const CS_UNIT_HZ      = 2;   // plain integer Hz; log stepping (8.8-octave step)
export const CS_UNIT_Q       = 3;   // 8.8 Q; log stepping (8.8-octave step)
export const CS_UNIT_PERCENT = 4;   // 8.8 percent; linear stepping
export const CS_UNIT_MS      = 5;   // 8.8 milliseconds; linear stepping, 0.1 ms default step (caps v4+)

// Units this console can encode/decode. A noun carrying a unit above this is
// from a newer caps format -- offering it in the editor would write mis-scaled
// values to the device, so the pickers skip it.
export const CS_MAX_KNOWN_UNIT = CS_UNIT_MS;

// Target kinds (CsNounDesc.targetKind); what CsBinding.target addresses.
export const CS_TARGET_NONE      = 0;   // target/index ignored
export const CS_TARGET_INPUT_CH  = 1;   // target = input channel (0..targetCount-1)
export const CS_TARGET_OUTPUT_CH = 2;   // target = output channel (0..targetCount-1)
export const CS_TARGET_DSP_CH    = 3;   // target = DSP channel (inputs then outputs)
export const CS_TARGET_DSP_BAND  = 4;   // target = DSP channel, index = filter band

// Noun descriptor flags (CsNounDesc.dflags)
export const CS_NDF_DEFERRED = 0x01;   // apply is deferred; engine steps from a target shadow

// ADC-capable GPIOs on both platforms (RP2040/RP2350A: 26-28; RP2350B: 26-28, 40-43; GPIO 29 is VSYS monitor).
export const CS_ADC_PINS: readonly number[] = [26, 27, 28, 40, 41, 42, 43];

// One binding, host shape. gpio1 is null unless the type takes two pins;
// continuous value/step/range fields stay in raw wire encoding (8.8 for
// dB/Q/percent, plain integer for Hz) -- conversion belongs to the edit
// boundary, not the stored config.
export interface CsBinding {
  type: CsType;
  noun: CsNoun;
  action: CsAction;
  flags: number;
  gpio0: number;
  gpio1: number | null;
  event: CsEvent;
  // A group index (0-7) instead of a channel when CS_FLAG_GROUP is set.
  target: number;
  index: number;
  value: number;
  step: number;
  rangeMin: number;
  rangeMax: number;
  // Percent 1-100, 0 = unset = full brightness (caps v12, CS_TYPE_LED_PWM
  // only). Scales the final PWM duty linearly, applied before INVERT.
  baseBright: number;
  // 0.1 s units, 0 = immediate (caps v8). Legal only on LED/LED_PWM
  // IND_EQUALS/IND_ABOVE: onDelay is a PLC TON (condition must hold true this
  // long before the LED lights), offDelay a PLC TOF (hold false this long
  // before it goes out).
  onDelay: number;
  offDelay: number;
  // Reserved wire bytes carried through an edit round-trip verbatim (never
  // zero-filled): a future format may carve a real field out of them. Absent
  // means zeros (a fresh binding).
  reserved2?: readonly number[];
}

// A cleared slot is the ALL-ZERO 24-byte blob -- gpio1 is 0 here, not
// 0xFF/null (the 0xFF sentinel marks the unused second pin of a CONFIGURED
// single-pin binding; a cleared slot has no pins at all).
export const EMPTY_CS_BINDING: CsBinding = {
  type: CsType.None, noun: CsNoun.UserVolume, action: CsAction.Adjust, flags: 0,
  gpio0: 0, gpio1: 0, event: CsEvent.Press, target: 0, index: 0,
  value: 0, step: 0, rangeMin: 0, rangeMax: 0,
  baseBright: 0, onDelay: 0, offDelay: 0, reserved2: [0, 0],
};

// One IR sub-slot command: a button-shaped binding fired by a learned
// protocol+code instead of a GPIO edge (section 2.7). noun/action/target/
// index/value/step follow the same rules as CsBinding's fields of the same
// names; there is no gpio/event/range -- those are the container binding's.
export interface CsIrCommand {
  noun: CsNoun;
  action: CsAction;
  flags: number;
  target: number;
  index: number;
  protocol: CsIrProto;
  value: number;
  step: number;
  code: number;
}

// A cleared sub-slot is the ALL-ZERO 16-byte blob (protocol NONE, code 0).
export const EMPTY_CS_IR_COMMAND: CsIrCommand = {
  noun: CsNoun.UserVolume, action: CsAction.Adjust, flags: 0,
  target: 0, index: 0, protocol: CsIrProto.None, value: 0, step: 0, code: 0,
};

// CsIrLearn(wValue=2) result read / GetCsStatus.irLearnState pairing.
// protocol/code read 0 while idle/armed or on a timeout.
export interface CsIrLearnResult {
  state: number;   // CS_IR_LEARN_*
  protocol: CsIrProto;
  code: number;
}

// One target group (caps v9+): a named set of channels a grouped binding or
// IR command addresses at once via CS_FLAG_GROUP. targetKind 0 = empty slot.
export interface CsGroup {
  targetKind: number;   // CS_TARGET_INPUT_CH / OUTPUT_CH / DSP_CH; 0 = empty
  memberMask: number;   // bit N = channel N of the kind's space
  name: string;
}

export const EMPTY_CS_GROUP: CsGroup = { targetKind: CS_TARGET_NONE, memberMask: 0, name: '' };

// The action subset a macro step may carry (caps v9+): SET/TOGGLE/INC/DEC/
// TRIGGER -- no pot/encoder/indicator actions, MOMENTARY, or FOLLOW. A step is
// a scripted change, not a live control.
export const CS_MACRO_STEP_ACTIONS =
  (1 << CsAction.Set) | (1 << CsAction.Toggle) | (1 << CsAction.Inc) | (1 << CsAction.Dec) | (1 << CsAction.Trigger);

export const CS_MACRO_STEP_FLAGS = CS_FLAG_WRAP | CS_FLAG_GROUP;

// One macro step (caps v9+, element of CsMacro.steps / SET payload of
// SetCsMacroStep). value/step follow the same raw wire encoding as
// CsBinding's fields of the same names; preDelay is 10 ms units, elapsing
// before the step runs. `target` is a group index instead of a channel when
// CS_FLAG_GROUP is set, same as CsBinding.
export interface CsMacroStep {
  noun: CsNoun;
  action: CsAction;
  flags: number;
  target: number;
  index: number;
  value: number;
  step: number;
  preDelay: number;
}

// An all-zero record: always valid, skipped at run time.
export const EMPTY_CS_MACRO_STEP: CsMacroStep = {
  noun: CsNoun.UserVolume, action: CsAction.Adjust, flags: 0, target: 0, index: 0,
  value: 0, step: 0, preDelay: 0,
};

// One macro (caps v9+, GetCsMacro 0x23 response / target of SetCsMacro
// 0x22 + SetCsMacroStep 0x24): a named list of up to CS_MAX_MACRO_STEPS
// steps, fired in sequence by CS_NOUN_MACRO or CsMacroFire. `steps` is
// always the full wire-length array; execution and validity only consider
// `steps[0..stepCount)` -- a stale tail step beyond stepCount is inert.
export interface CsMacro {
  name: string;
  stepCount: number;
  steps: CsMacroStep[];
}

export const EMPTY_CS_MACRO: CsMacro = {
  name: '', stepCount: 0,
  steps: Array.from({ length: CS_MAX_MACRO_STEPS }, () => ({ ...EMPTY_CS_MACRO_STEP })),
};

export function csMacroStepIsEmpty(s: CsMacroStep): boolean {
  return s.noun === CsNoun.UserVolume && s.action === CsAction.Adjust && s.flags === 0 &&
    s.target === 0 && s.index === 0 && s.value === 0 && s.step === 0 && s.preDelay === 0;
}

// The panel's "slot free" test: a stale tail step beyond stepCount doesn't
// count, so a macro with leftover step data from a shrunk header still reads
// as empty here.
export function csMacroIsEmpty(m: CsMacro): boolean {
  return m.name === '' && m.stepCount === 0;
}

// GetCsExtStatus (0x26) packet: group/macro ceilings and per-slot validity.
// Macro fields (0x22-0x25) are modeled -- see CsMacro/CsMacroStep above.
export interface CsExtStatus {
  maxGroups: number;
  maxMacros: number;
  maxMacroSteps: number;
  macroRunning: number | null;   // null when idle (wire 0xFF)
  macroStep: number;
  groupStatus: number[];
  macroStatus: number[];
}

export const CS_MAX_DISPLAY_PAGES = 16;

// I2C displays (caps v10+): a CS_TYPE_DISPLAY binding's `index` selects one
// of these modules, `value` an override 7-bit address (0 = the module's own
// default). Character modules (1-5) render through CGRAM/HD44780 text
// addressing; the graphic modules (6-8) also honor the LARGE page flag and
// pixel-invert bars -- `graphic` marks that distinction for the panel.
export const CsDisplayModel = {
  None:            0,
  Lcd1602:         1,
  Lcd2004:         2,
  CharOled16x2:    3,
  CharOled20x2:    4,
  CharOled20x4:    5,
  Ssd1306_128x64:  6,
  Ssd1306_128x32:  7,
  Sh1106_128x64:   8,
} as const;
export type CsDisplayModel = (typeof CsDisplayModel)[keyof typeof CsDisplayModel];

export interface CsDisplayModelInfo {
  model: number;
  label: string;
  cols: number;
  rows: number;
  graphic: boolean;
  defaultAddr: number;
  khz: number;
  fiveVolt: boolean;   // 5 V module bus -- needs a level shifter on 3.3 V GPIOs
}

export const CS_DISPLAY_MODELS: readonly CsDisplayModelInfo[] = [
  { model: CsDisplayModel.Lcd1602,        label: 'LCD 16×2 (HD44780 + PCF8574)',            cols: 16, rows: 2, graphic: false, defaultAddr: 0x27, khz: 100, fiveVolt: true },
  { model: CsDisplayModel.Lcd2004,        label: 'LCD 20×4 (HD44780 + PCF8574)',            cols: 20, rows: 4, graphic: false, defaultAddr: 0x27, khz: 100, fiveVolt: true },
  { model: CsDisplayModel.CharOled16x2,   label: 'Character OLED 16×2 (US2066/RW1063)',     cols: 16, rows: 2, graphic: false, defaultAddr: 0x3C, khz: 400, fiveVolt: false },
  { model: CsDisplayModel.CharOled20x2,   label: 'Character OLED 20×2 (US2066/RW1063)',     cols: 20, rows: 2, graphic: false, defaultAddr: 0x3C, khz: 400, fiveVolt: false },
  { model: CsDisplayModel.CharOled20x4,   label: 'Character OLED 20×4 (US2066/RW1063)',     cols: 20, rows: 4, graphic: false, defaultAddr: 0x3C, khz: 400, fiveVolt: false },
  { model: CsDisplayModel.Ssd1306_128x64, label: 'OLED 128×64 (SSD1306)',                   cols: 21, rows: 8, graphic: true,  defaultAddr: 0x3C, khz: 400, fiveVolt: false },
  { model: CsDisplayModel.Ssd1306_128x32, label: 'OLED 128×32 (SSD1306)',                   cols: 21, rows: 4, graphic: true,  defaultAddr: 0x3C, khz: 400, fiveVolt: false },
  { model: CsDisplayModel.Sh1106_128x64,  label: 'OLED 128×64 (SH1106)',                    cols: 21, rows: 8, graphic: true,  defaultAddr: 0x3C, khz: 400, fiveVolt: false },
];

// undefined for model 0 (none) or a model a newer firmware added beyond this
// table -- the picker falls back to `Model N` for those.
export function csDisplayModelInfo(model: number): CsDisplayModelInfo | undefined {
  return CS_DISPLAY_MODELS.find((m) => m.model === model);
}

export const CS_DISPLAY_ADDR_MIN = 0x08;
export const CS_DISPLAY_ADDR_MAX = 0x77;

// Caps type row carries no model count of its own -- 1..CS_DISPLAY_MODEL_COUNT-1
// is the fw's fixed model range (CS_DISP_MODEL_COUNT); a device-reported
// `CsDisplayLimits.modelCount` is the authority for what the panel offers.
export const CS_DISPLAY_MODEL_COUNT = 9;

export const CsDisplayMode = { Fixed: 0, CycleSelected: 1, CycleAll: 2 } as const;
export type CsDisplayMode = (typeof CsDisplayMode)[keyof typeof CsDisplayMode];

export const CS_DISPLAY_MODE_LABEL: Record<CsDisplayMode, string> = {
  [CsDisplayMode.Fixed]:         'Fixed page',
  [CsDisplayMode.CycleSelected]: 'Cycle selected pages',
  [CsDisplayMode.CycleAll]:      'Cycle everything',
};

export const CsDisplayAlign = { Left: 0, Centre: 1, Right: 2 } as const;
export type CsDisplayAlign = (typeof CsDisplayAlign)[keyof typeof CsDisplayAlign];

export const CS_DISPLAY_ALIGN_LABEL: Record<CsDisplayAlign, string> = {
  [CsDisplayAlign.Left]:   'Left',
  [CsDisplayAlign.Centre]: 'Centre',
  [CsDisplayAlign.Right]:  'Right',
};

// CsDisplayCfg.flags (byte 7).
export const CS_DCFG_OVERLAY_ANY      = 0x01;
export const CS_DCFG_EDIT_GATED       = 0x02;
export const CS_DCFG_LABEL_ALIGN_SHIFT = 2;
export const CS_DCFG_VALUE_ALIGN_SHIFT = 4;
export const CS_DCFG_ALIGN_MASK        = 0x03;
export const CS_DCFG_KNOWN_FLAGS       = 0x3F;

// CsDisplayPage.flags.
export const CS_DPAGE_ACTIVE      = 0x01;
export const CS_DPAGE_GROUP       = 0x02;
export const CS_DPAGE_LARGE       = 0x04;
export const CS_DPAGE_BAR         = 0x08;
export const CS_DPAGE_KNOWN_FLAGS = 0x0F;

// CsDisplayStatus.flags.
export const CS_DSTATUS_OVERLAY = 0x01;
export const CS_DSTATUS_EDIT    = 0x02;

// The display's own settings blob (SET payload of 0x27, GET tail of 0x28).
// Wire units throughout: dwell/overlayHold/editTimeout are 0.1 s ticks.
export interface CsDisplayCfg {
  mode: CsDisplayMode;
  homePage: number;
  dwell: number;
  overlayHold: number;
  brightness: number;
  flags: number;
  editTimeout: number;
}

export const EMPTY_CS_DISPLAY_CFG: CsDisplayCfg = {
  mode: CsDisplayMode.Fixed, homePage: 0, dwell: 0, overlayHold: 0,
  brightness: 0, flags: 0, editTimeout: 0,
};

// What firmware's disp_seed_pages produces on a zero cfg the first time a
// display attaches with no ACTIVE page stored.
export const SEEDED_CS_DISPLAY_CFG: CsDisplayCfg = {
  mode: CsDisplayMode.Fixed, homePage: 0, dwell: 30, overlayHold: 20,
  brightness: 0, flags: CS_DCFG_EDIT_GATED, editTimeout: 100,
};

export function csDisplayCfgIsEmpty(c: CsDisplayCfg): boolean {
  return c.mode === CsDisplayMode.Fixed && c.homePage === 0 && c.dwell === 0 &&
    c.overlayHold === 0 && c.brightness === 0 && c.flags === 0 && c.editTimeout === 0;
}

// GetCsDisplayCfg's (0x28) header: ceilings the panel sizes its editors from.
export interface CsDisplayLimits {
  maxPages: number;
  modelCount: number;
}

// One display page slot (SET payload of 0x29, GET response of 0x2A).
export interface CsDisplayPage {
  noun: CsNoun;
  target: number;
  index: number;
  flags: number;
}

export const EMPTY_CS_DISPLAY_PAGE: CsDisplayPage = { noun: CsNoun.UserVolume, target: 0, index: 0, flags: 0 };

export function csDisplayPageIsEmpty(p: CsDisplayPage): boolean {
  return !(p.flags & CS_DPAGE_ACTIVE);
}

export const CsDisplayInitState = { Down: 0, Init: 1, Live: 2, Error: 3 } as const;
export type CsDisplayInitState = (typeof CsDisplayInitState)[keyof typeof CsDisplayInitState];

export const CS_DISPLAY_INIT_STATE_LABEL: Record<CsDisplayInitState, string> = {
  [CsDisplayInitState.Down]:  'NO DISPLAY',
  [CsDisplayInitState.Init]:  'STARTING',
  [CsDisplayInitState.Live]:  'LIVE',
  [CsDisplayInitState.Error]: 'ERROR',
};

// GetCsDisplayStatus (0x2B), host shape. `model` is the live binding's index
// while attached (0 when down); the I2C address is not reported -- resolve
// it from `model` + the binding's `value` via csDisplayResolvedAddr.
export interface CsDisplayStatus {
  initState: CsDisplayInitState;
  currentPage: number | null;   // null = wire 0xFF (no active page shown)
  overlay: boolean;
  editArmed: boolean;
  model: number;
  nakCount: number;
}

export function csDisplayResolvedAddr(model: number, value: number): number {
  return value || csDisplayModelInfo(model)?.defaultAddr || 0;
}

// Device-served capability tables (GetCsCaps).
export interface CsTypeCaps {
  actions: number;    // CS_ACT bit mask this component can drive
  pinCount: number;   // 0 (NONE), 1, or 2
  pinClass: number;   // CS_PINCLASS_*
}

export interface CsCaps {
  capsVersion: number;
  maxBindings: number;
  types: CsTypeCaps[];
  maxIrCommands: number;
  maxGroups: number;
  maxMacros: number;
  maxMacroSteps: number;
}

// I2C displays exist from caps v10, told apart from the maxGroups/maxMacros
// style ceiling by the presence of the DISPLAY row in the type table itself.
export function csDisplaysAvailable(caps: CsCaps | null): boolean {
  return caps != null && caps.capsVersion >= 10 && caps.types.length > CsType.Display;
}

export interface CsNounCaps {
  kind: CsKind;
  enumCount: number;
  actions: number;
  minQ8: number;
  maxQ8: number;
  unit: number;         // CS_UNIT_*
  targetKind: number;   // CS_TARGET_*
  targetCount: number;
  dflags: number;       // CS_NDF_*
}

// GetCsStatus packet, host shape.
export interface CsStatus {
  lastStatus: number;
  lastSlot: number;
  maxBindings: number;
  dirty: boolean;
  activeMask: number;   // 16 bits: bit N = binding N live
  slotStatus: number[];
  irActiveMask: number;
  irLearnState: number;
  irCmdStatus: number[];
}

// Shared 8.8 fixed-point encode/decode: dB (1.0 dB = 256), percent (1% =
// 256), and Q (Q 0.707 = 181) all use the identical scaling; only their
// meaning differs. Hz values are plain integers on the wire (no conversion).
function q8Encode(x: number): number { return Math.round(x * 256); }
function q8Decode(q8: number): number { return q8 / 256; }

export const dbToQ8 = q8Encode;
export const q8ToDb = q8Decode;

export const percentToQ8 = q8Encode;
export const q8ToPercent = q8Decode;

export const qToQ8 = q8Encode;
export const q8ToQ = q8Decode;

export const msToQ8 = q8Encode;
export const q8ToMs = q8Decode;

// CsBinding.step on a CS_UNIT_HZ/CS_UNIT_Q binding encodes an 8.8-octave
// step size: 256 is one octave per detent; 0 selects the firmware's default
// (1/12 octave).
export const octavesToQ8Step = q8Encode;
export const q8StepToOctaves = q8Decode;

// The legal action set for a (type, noun) pair: bit positions present in
// BOTH masks, in ascending action order. Empty = the pair is invalid.
export function legalActions(typeActions: number, nounActions: number): CsAction[] {
  const both = typeActions & nounActions;
  const out: CsAction[] = [];
  for (let a = 0; a < 16; a++) {
    if (both & (1 << a)) out.push(a as CsAction);
  }
  return out;
}

export const CS_TYPE_LABEL: Record<CsType, string> = {
  [CsType.None]:    '—',
  [CsType.Button]:  'Push Button',
  [CsType.Switch]:  'Toggle Switch',
  [CsType.Pot]:     'Potentiometer / Fader',
  [CsType.Encoder]: 'Rotary Encoder',
  [CsType.Led]:     'Indicator LED',
  [CsType.LedPwm]:  'PWM-Dimmed LED',
  [CsType.Ir]:      'IR Remote Receiver',
  [CsType.Display]: 'I2C display',
};

export const CS_NOUN_LABEL: Record<CsNoun, string> = {
  [CsNoun.UserVolume]:        'Volume',
  [CsNoun.MasterVolume]:      'Master Volume',
  [CsNoun.UserMute]:          'Mute',
  [CsNoun.Loudness]:          'Loudness',
  [CsNoun.Crossfeed]:         'Crossfeed',
  [CsNoun.Leveller]:          'Volume Leveller',
  [CsNoun.Preset]:            'Preset',
  [CsNoun.InputSource]:       'Input Source',
  [CsNoun.Clip]:              'Clip Indicator',
  [CsNoun.EqBypass]:          'EQ Bypass',
  [CsNoun.LgSync]:            'LG Sound Sync',
  [CsNoun.CrossfeedPreset]:   'Crossfeed Voicing',
  [CsNoun.CrossfeedItd]:      'Crossfeed ITD',
  [CsNoun.LevellerAmount]:    'Leveller Amount',
  [CsNoun.LevellerSpeed]:     'Leveller Speed',
  [CsNoun.LevellerLookahead]: 'Leveller Lookahead',
  [CsNoun.Preamp]:            'Input Preamp',
  [CsNoun.OutputGain]:        'Output Gain',
  [CsNoun.OutputMute]:        'Output Mute',
  [CsNoun.OutputEnable]:      'Output Enable',
  [CsNoun.FilterFreq]:        'Filter Frequency',
  [CsNoun.FilterGain]:        'Filter Gain',
  [CsNoun.FilterQ]:           'Filter Q',
  [CsNoun.FilterType]:        'Filter Type',
  [CsNoun.FilterBypass]:      'Filter Bypass',
  [CsNoun.Siggen]:            'Test Signal Generator',
  [CsNoun.DacMuteTest]:       'DAC Mute Test',
  [CsNoun.ClipCh]:            'Channel Clip',
  [CsNoun.Level]:             'Channel Level',
  [CsNoun.SpdifLock]:         'S/PDIF Lock',
  [CsNoun.SampleRate]:        'Sample Rate',
  [CsNoun.UsbStreaming]:      'USB Streaming',
  [CsNoun.AdatActive]:        'ADAT Active',
  [CsNoun.LgPresent]:         'LG Source Present',
  [CsNoun.LgMuted]:           'LG Source Muted',
  [CsNoun.Upmix]:             'Stereo Upmixer',
  [CsNoun.UpmixCenterMode]:   'Upmix Centre Mode',
  [CsNoun.UpmixSurroundMode]: 'Upmix Surround Mode',
  [CsNoun.UpmixStrength]:     'Upmix Strength',
  [CsNoun.UpmixWidth]:        'Upmix Centre Width',
  [CsNoun.UpmixPresence]:     'Upmix Centre Presence',
  [CsNoun.Psybass]:           'Psybass',
  [CsNoun.PsybassCutoff]:     'Psybass Cutoff',
  [CsNoun.PsybassHarmonics]:  'Psybass Harmonics',
  [CsNoun.PsybassDrive]:      'Psybass Drive',
  [CsNoun.PsybassCharacter]:  'Psybass Character',
  [CsNoun.PsybassOriginal]:   'Psybass Original Level',
  [CsNoun.OutputDelay]:       'Output Delay',
  [CsNoun.PresetReload]:      'Reload Preset',
  [CsNoun.LoudnessSpl]:       'Loudness Reference SPL',
  [CsNoun.LoudnessIntensity]: 'Loudness Intensity',
  [CsNoun.InputLevelMax]:     'Input Signal Level',
  [CsNoun.Macro]:             'Macro',
  [CsNoun.CpuLoad]:           'CPU Load',
  [CsNoun.DisplayPage]:       'Display Page',
  [CsNoun.DisplayEdit]:       'Display Edit',
  [CsNoun.PageValue]:         'Display Page Value',
  [CsNoun.Subharm]:           'Subharmonic Synth',
  [CsNoun.SubharmLow]:        'Subharm 24–36 Hz',
  [CsNoun.SubharmHigh]:       'Subharm 36–56 Hz',
  [CsNoun.SubharmBoost]:      'Subharm LF Boost',
};

// A device with a newer caps format may publish nouns this console has no
// name for; they stay offerable (the descriptor fully describes them) as
// long as their unit is known.
export function csNounLabel(noun: number): string {
  return CS_NOUN_LABEL[noun as CsNoun] ?? `Function ${noun}`;
}

// Same fallback for component types a newer caps format publishes -- the
// raw Record lookup would render undefined.
export function csTypeLabel(type: number): string {
  return CS_TYPE_LABEL[type as CsType] ?? `Component ${type}`;
}

export const CS_GROUP_KIND_LABEL: Record<number, string> = {
  [CS_TARGET_INPUT_CH]:  'Input channels',
  [CS_TARGET_OUTPUT_CH]: 'Output channels',
  [CS_TARGET_DSP_CH]:    'DSP channels',
};

export function csGroupKindLabel(kind: number): string {
  return CS_GROUP_KIND_LABEL[kind] ?? `Kind ${kind}`;
}

export const CS_EVENT_LABEL: Record<CsEvent, string> = {
  [CsEvent.Press]:  'Press',
  [CsEvent.Long]:   'Long Press',
  [CsEvent.Double]: 'Double Press',
};

export const CS_IR_PROTO_LABEL: Record<CsIrProto, string> = {
  [CsIrProto.None]: '—',
  [CsIrProto.Nec]:  'NEC',
  [CsIrProto.Rc5]:  'RC5',
  [CsIrProto.Rc6]:  'RC6',
  [CsIrProto.Hash]: 'Hash',
};

// Action labels read differently against an enum noun: stepping a preset is
// "Next"/"Previous", stepping a volume is "Increase"/"Decrease".
export function csActionLabel(action: CsAction, isEnum: boolean): string {
  switch (action) {
    case CsAction.Adjust:    return 'Adjust';
    case CsAction.Step:      return 'Step';
    case CsAction.Inc:       return isEnum ? 'Next' : 'Increase';
    case CsAction.Dec:       return isEnum ? 'Previous' : 'Decrease';
    case CsAction.Toggle:    return 'Toggle';
    case CsAction.Set:       return 'Set value';
    case CsAction.Follow:    return 'Follow position';
    case CsAction.Trigger:   return 'Trigger';
    case CsAction.IndEquals: return 'Indicate';
    case CsAction.Momentary: return 'Hold (momentary)';
    case CsAction.IndAbove:  return 'Indicate above';
    case CsAction.IndLevel:  return 'Indicate level (PWM)';
  }
}

// Projection for pins.CtrlIfaceConfigs.cs: only LIVE bindings reserve pins
// (mirrors fw control_surfaces_owns_pin); a stored-but-down slot holds none.
export function liveCsPinConfigs(
  bindings: readonly (CsBinding | null)[], status: CsStatus | null,
): ({ gpio0: number; gpio1: number | null; display?: true } | null)[] {
  return bindings.map((b, i) =>
    b && status && (status.activeMask & (1 << i))
      ? { gpio0: b.gpio0, gpio1: b.gpio1, ...(b.type === CsType.Display ? { display: true as const } : {}) }
      : null);
}

// Target/index bounds for a binding's noun, mirroring firmware's
// cs_noun_validate_target. Per-channel band existence (crossover vs. PEQ) is
// device runtime state the caps tables don't carry, so CS_TARGET_DSP_BAND
// only bounds `target`, same as the other targeted kinds -- the device is
// still the final authority (INVALID_TARGET on a genuinely bad band).
function validateCsTarget(b: { target: number; index: number }, noun: CsNounCaps): number {
  switch (noun.targetKind) {
    case CS_TARGET_NONE:
      return (b.target !== 0 || b.index !== 0) ? 0x17 : 0x00;         // INVALID_TARGET
    case CS_TARGET_INPUT_CH:
    case CS_TARGET_OUTPUT_CH:
    case CS_TARGET_DSP_CH:
      return (b.target >= noun.targetCount || b.index !== 0) ? 0x17 : 0x00;
    case CS_TARGET_DSP_BAND:
      return (b.target >= noun.targetCount) ? 0x17 : 0x00;
    default:
      return 0x17;
  }
}

// Live channel counts by kind, for validateCsGroup's client-side bounds
// check (mirrors fw's NUM_INPUT_CHANNELS / NUM_OUTPUT_CHANNELS / NUM_CHANNELS).
export interface CsChannelCounts {
  inputs: number;
  outputs: number;
  dsp: number;
}

export function csChannelCountForKind(kind: number, counts: CsChannelCounts): number {
  switch (kind) {
    case CS_TARGET_INPUT_CH:  return counts.inputs;
    case CS_TARGET_OUTPUT_CH: return counts.outputs;
    case CS_TARGET_DSP_CH:    return counts.dsp;
    default:                  return 0;
  }
}

// All-ones mask for `count` bits (all ones when count >= 32 -- (1 << 32) - 1
// is not representable with a 32-bit shift).
function maskLimit(count: number): number {
  return count >= 32 ? 0xFFFFFFFF : ((1 << count) - 1) >>> 0;
}

// The group kind a noun's targets live in: DSP_CH and DSP_BAND nouns both
// group over the DSP channel space (a band lives on a channel). An untargeted
// noun cannot be grouped.
export function csGroupKindForNoun(noun: CsNounCaps): number {
  switch (noun.targetKind) {
    case CS_TARGET_INPUT_CH:  return CS_TARGET_INPUT_CH;
    case CS_TARGET_OUTPUT_CH: return CS_TARGET_OUTPUT_CH;
    case CS_TARGET_DSP_CH:
    case CS_TARGET_DSP_BAND:  return CS_TARGET_DSP_CH;
    default:                  return CS_TARGET_NONE;
  }
}

// The group's members that fall within the noun's own addressing range.
export function csGroupMembers(group: CsGroup, noun: CsNounCaps): number {
  return group.memberMask & maskLimit(noun.targetCount);
}

// Client-side pre-validation for one stored group, mirroring fw
// cs_validate_group: an empty (targetKind NONE) slot must be the whole-zero
// record; otherwise the kind must be one of the three channel kinds and the
// mask must be non-empty and within the kind's live channel count.
export function validateCsGroup(g: CsGroup, counts: CsChannelCounts): number {
  if (g.targetKind === CS_TARGET_NONE) {
    return (g.memberMask !== 0 || g.name !== '') ? 0x14 : 0x00;   // INVALID_VALUE
  }
  if (g.targetKind !== CS_TARGET_INPUT_CH && g.targetKind !== CS_TARGET_OUTPUT_CH && g.targetKind !== CS_TARGET_DSP_CH) {
    return 0x1F;                                                  // INVALID_GROUP
  }
  const lim = maskLimit(csChannelCountForKind(g.targetKind, counts));
  if (g.memberMask === 0 || (g.memberMask & ~lim) !== 0) return 0x1F;
  return 0x00;
}

// Client-side pre-validation for a grouped binding/IR command's target,
// mirroring fw cs_validate_group_ref (replaces validateCsTarget when
// CS_FLAG_GROUP is set).
function validateCsGroupRef(
  b: { target: number; index: number }, noun: CsNounCaps, groups: readonly (CsGroup | null)[],
): number {
  if (b.target >= CS_MAX_GROUPS) return 0x1F;                     // INVALID_GROUP
  const group = groups[b.target];
  if (!group || group.targetKind === CS_TARGET_NONE) return 0x1F;
  const wantKind = csGroupKindForNoun(noun);
  if (wantKind === CS_TARGET_NONE || group.targetKind !== wantKind) return 0x1F;
  if (csGroupMembers(group, noun) === 0) return 0x1F;
  // DSP_BAND: per-channel band existence is device runtime state the tables
  // don't carry, so the console can't bound `index` any further here.
  if (noun.targetKind !== CS_TARGET_DSP_BAND && b.index !== 0) return 0x17;  // INVALID_TARGET
  return 0x00;
}

// Client-side pre-validation mirroring the firmware's cs_validate() order:
// type -> noun -> action -> flags -> base_bright/delays/reserved2 -> (IR
// container fields | action-allowed-by-both-masks -> event -> repeat/accel
// flags -> target -> value/step/range bounds) -> pin class/shape. Returns 0
// on success or the CS_STATUS_* / PIN_CONFIG_* byte the firmware would
// produce. Checks that need cross-binding or device state (pin conflicts,
// PWM slice sharing, one-IR-per-device) stay with the caller -- they are
// device truth, not table truth.
export function validateCsBinding(
  b: CsBinding, caps: CsCaps, nouns: readonly CsNounCaps[],
  groups: readonly (CsGroup | null)[] = [], liveI2cInstance: number | null = null,
): number {
  if (b.type === CsType.None) return 0x00;                       // clear is always valid
  if (b.type >= caps.types.length) return 0x11;                  // INVALID_TYPE
  if (b.noun >= nouns.length) return 0x12;                       // INVALID_NOUN
  if (b.action >= CS_ACTION_COUNT) return 0x13;                  // INVALID_ACTION
  if (b.flags & ~CS_KNOWN_FLAGS) return 0x14;                    // INVALID_VALUE (unknown flags)

  const type = caps.types[b.type];
  const noun = nouns[b.noun];

  if ((b.flags & CS_GROUP_FLAGS) && caps.capsVersion < 9) return 0x14;  // pre-v9 fw sees unknown bits
  if ((b.flags & CS_FLAG_LINK_ABS) &&
      !((b.flags & CS_FLAG_GROUP) && b.action === CsAction.Adjust && noun.kind === CsKind.Continuous))
    return 0x14;
  if ((b.flags & CS_FLAG_GROUP_ALL) &&
      !((b.flags & CS_FLAG_GROUP) && (b.action === CsAction.IndEquals || b.action === CsAction.IndAbove)))
    return 0x14;

  if (b.baseBright < 0 || b.baseBright > 100) return 0x14;
  if (b.baseBright !== 0 && b.type !== CsType.LedPwm) return 0x14;
  if (b.baseBright !== 0 && caps.capsVersion < 12) return 0x14;  // pre-v12 fw sees a reserved byte

  if (b.onDelay < 0 || b.onDelay > 0xFFFF || b.offDelay < 0 || b.offDelay > 0xFFFF) return 0x14;
  const delayed = b.onDelay !== 0 || b.offDelay !== 0;
  const delayable = (b.type === CsType.Led || b.type === CsType.LedPwm) &&
    (b.action === CsAction.IndEquals || b.action === CsAction.IndAbove);
  if (delayed && !delayable) return 0x14;
  if (delayed && caps.capsVersion < 8) return 0x14;              // pre-v8 fw sees reserved bytes

  if (b.reserved2 && b.reserved2.some((byte) => byte !== 0)) return 0x14;

  if (b.type === CsType.Ir) {
    // Container slot: the receiver pin and its idle sense (INVERT) are the
    // only payload; everything else must read as the empty binding.
    if (b.noun !== 0 || b.action !== 0 || b.event !== CsEvent.Press ||
        b.target !== 0 || b.index !== 0 ||
        b.value !== 0 || b.step !== 0 || b.rangeMin !== 0 || b.rangeMax !== 0)
      return 0x14;
    if (b.flags & ~CS_FLAG_INVERT) return 0x14;
  } else if (b.type === CsType.Display) {
    // Container slot: model (index) and an optional address override
    // (value) are the only payload; everything else must read as empty.
    if (b.noun !== 0 || b.action !== 0 || b.event !== CsEvent.Press || b.target !== 0 ||
        b.step !== 0 || b.rangeMin !== 0 || b.rangeMax !== 0 || b.flags !== 0)
      return 0x14;
    if (b.index === 0 || b.index >= CS_DISPLAY_MODEL_COUNT) return 0x14;
    if (b.value !== 0 && (b.value < CS_DISPLAY_ADDR_MIN || b.value > CS_DISPLAY_ADDR_MAX)) return 0x14;
    if (b.gpio1 != null) {
      if ((b.gpio0 & 1) !== 0 || (b.gpio1 & 1) !== 1 || i2cInstance(b.gpio0) !== i2cInstance(b.gpio1))
        return 0x23;                                                  // PIN_NOT_I2C
      if (liveI2cInstance === i2cInstance(b.gpio0)) return 0x24;      // I2C_IN_USE
    }
  } else {
    if (!(type.actions & noun.actions & (1 << b.action))) return 0x13; // INVALID_ACTION

    // Events are a button concept; everything else must carry 0.
    if (b.type === CsType.Button) {
      if (b.event >= CS_EVENT_COUNT) return 0x18;                // INVALID_EVENT
      if ((b.action === CsAction.Momentary || (b.flags & CS_FLAG_REPEAT)) && b.event !== CsEvent.Press)
        return 0x18;
    } else if (b.event !== 0) {
      return 0x18;
    }
    if ((b.flags & CS_FLAG_REPEAT) &&
        (b.type !== CsType.Button || (b.action !== CsAction.Inc && b.action !== CsAction.Dec)))
      return 0x14;
    if ((b.flags & CS_FLAG_ACCEL) && b.type !== CsType.Encoder) return 0x14;

    const targetStatus = (b.flags & CS_FLAG_GROUP)
      ? validateCsGroupRef(b, noun, groups)
      : validateCsTarget(b, noun);
    if (targetStatus !== 0x00) return targetStatus;

    if (noun.kind === CsKind.Continuous) {
      if ((b.action === CsAction.Set || b.action === CsAction.IndAbove) &&
          (b.value < noun.minQ8 || b.value > noun.maxQ8)) return 0x14;
      if (b.step < 0) return 0x14;
      if ((b.action === CsAction.Adjust || b.action === CsAction.IndLevel) &&
          (b.rangeMin !== 0 || b.rangeMax !== 0)) {
        if (b.rangeMin >= b.rangeMax || b.rangeMin < noun.minQ8 || b.rangeMax > noun.maxQ8) return 0x14;
      }
    } else if (noun.kind === CsKind.Bool) {
      if ((b.action === CsAction.Set || b.action === CsAction.IndEquals || b.action === CsAction.Momentary) &&
          b.value !== 0 && b.value !== 1) return 0x14;
    } else if (noun.kind === CsKind.Enum) {
      if ((b.action === CsAction.Set || b.action === CsAction.IndEquals) &&
          (b.value < 0 || b.value >= noun.enumCount)) return 0x14;
    }

    if (b.noun === CsNoun.PageValue && (b.value !== 0 || b.step !== 0 || b.rangeMin !== 0 || b.rangeMax !== 0))
      return 0x14;
  }

  if (type.pinClass === CS_PINCLASS_ADC && !CS_ADC_PINS.includes(b.gpio0)) return 0x15; // PIN_NOT_ADC
  if (type.pinCount === 2 && (b.gpio1 == null || b.gpio1 === b.gpio0)) return 0x01;     // INVALID_PIN
  return 0x00;
}

// Client-side pre-validation for one IR sub-slot command, mirroring the same
// firmware check order as validateCsBinding above (minus the parts an
// IrCommand has no fields for: type, gpio/pin class, event). The one-IR-
// receiver-per-device check (CS_STATUS_IR_IN_USE) is a CsBinding concern, not
// this command's -- it belongs to the caller alongside the other cross-slot
// device state.
export function validateCsIrCommand(
  cmd: CsIrCommand, caps: CsCaps, nouns: readonly CsNounCaps[],
  groups: readonly (CsGroup | null)[] = [],
): number {
  const isEmpty = cmd.protocol === CsIrProto.None && cmd.noun === 0 && cmd.action === 0 &&
    cmd.flags === 0 && cmd.target === 0 && cmd.index === 0 &&
    cmd.value === 0 && cmd.step === 0 && cmd.code === 0;
  if (isEmpty) return 0x00;                                       // clear is always valid

  if (cmd.protocol === CsIrProto.None) return 0x14;               // non-zero remainder on an "empty" slot
  if (cmd.protocol > CsIrProto.Hash) return 0x14;                 // unrecognized protocol byte
  if (cmd.code === 0) return 0x14;                                // never-learned code on an occupied slot

  if (cmd.noun >= nouns.length) return 0x12;                      // INVALID_NOUN
  if (!(CS_IR_BUTTON_ACTIONS & (1 << cmd.action))) return 0x13;   // INVALID_ACTION (button subset only)
  // GROUP joins the allowed flag set at caps v10 (pre-v10 fw rejects it as
  // unknown); LINK_ABS/GROUP_ALL never apply to an IR command.
  const allowedFlags = CS_FLAG_WRAP | CS_FLAG_REPEAT | (caps.capsVersion >= 10 ? CS_FLAG_GROUP : 0);
  if (cmd.flags & ~allowedFlags) return 0x14;                     // INVALID_VALUE (unknown flags)

  if (cmd.noun === CsNoun.PageValue && (cmd.value !== 0 || cmd.step !== 0)) return 0x14;

  const irType = caps.types[CsType.Ir];
  const noun = nouns[cmd.noun];
  if (!irType || !(irType.actions & noun.actions & (1 << cmd.action))) return 0x13; // INVALID_ACTION

  if ((cmd.flags & CS_FLAG_REPEAT) && cmd.action !== CsAction.Inc && cmd.action !== CsAction.Dec)
    return 0x14;                                                  // INVALID_VALUE (REPEAT: INC/DEC only)

  const targetStatus = (cmd.flags & CS_FLAG_GROUP)
    ? validateCsGroupRef(cmd, noun, groups)
    : validateCsTarget(cmd, noun);
  if (targetStatus !== 0x00) return targetStatus;

  if (noun.kind === CsKind.Continuous) {
    if ((cmd.action === CsAction.Set || cmd.action === CsAction.Momentary) &&
        (cmd.value < noun.minQ8 || cmd.value > noun.maxQ8)) return 0x14;
    if (cmd.step < 0) return 0x14;
  } else if (noun.kind === CsKind.Bool) {
    if ((cmd.action === CsAction.Set || cmd.action === CsAction.Momentary) &&
        cmd.value !== 0 && cmd.value !== 1) return 0x14;
  } else if (noun.kind === CsKind.Enum) {
    if (cmd.action === CsAction.Set && (cmd.value < 0 || cmd.value >= noun.enumCount)) return 0x14;
  }
  return 0x00;
}

// Client-side pre-validation for one macro step, mirroring fw
// cs_validate_macro_step's order exactly: empty -> 0; noun bounds/MACRO/
// PAGE_VALUE -> INVALID_STEP; action outside the step subset -> INVALID_STEP;
// unknown flags -> INVALID_STEP; action not allowed by the noun's own mask ->
// INVALID_ACTION; target (group ref or plain) -> INVALID_GROUP/INVALID_TARGET;
// then value/step bounds as if the step were a BUTTON binding (no range
// fields on a step). preDelay's 16-bit bound is a client-side guard fw
// enforces structurally (the wire field is a u16).
export function validateCsMacroStep(
  s: CsMacroStep, nouns: readonly CsNounCaps[], groups: readonly (CsGroup | null)[] = [],
): number {
  if (csMacroStepIsEmpty(s)) return 0x00;
  if (s.noun >= nouns.length || s.noun === CsNoun.Macro || s.noun === CsNoun.PageValue) return 0x21; // INVALID_STEP
  if (s.action >= CS_ACTION_COUNT || !(CS_MACRO_STEP_ACTIONS & (1 << s.action))) return 0x21;         // INVALID_STEP
  if (s.flags & ~CS_MACRO_STEP_FLAGS) return 0x21;                                                    // INVALID_STEP

  const noun = nouns[s.noun];
  if (!(noun.actions & (1 << s.action))) return 0x13;             // INVALID_ACTION

  const targetStatus = (s.flags & CS_FLAG_GROUP)
    ? validateCsGroupRef(s, noun, groups)
    : validateCsTarget(s, noun);
  if (targetStatus !== 0x00) return targetStatus;

  if (noun.kind === CsKind.Continuous) {
    if (s.action === CsAction.Set && (s.value < noun.minQ8 || s.value > noun.maxQ8)) return 0x14;
    if (s.step < 0) return 0x14;
  } else if (noun.kind === CsKind.Bool) {
    if (s.action === CsAction.Set && s.value !== 0 && s.value !== 1) return 0x14;
  } else if (noun.kind === CsKind.Enum) {
    if (s.action === CsAction.Set && (s.value < 0 || s.value >= noun.enumCount)) return 0x14;
  }
  if (s.preDelay < 0 || s.preDelay > 0xFFFF) return 0x14;
  return 0x00;
}

// fw control_surfaces_apply_macro_header: step_count above the ceiling ->
// INVALID_MACRO.
export function validateCsMacroHeader(m: { stepCount: number }): number {
  return m.stepCount > CS_MAX_MACRO_STEPS ? 0x20 : 0x00;   // INVALID_MACRO
}

// Client-side pre-validation for a stored macro, mirroring
// cs_macro_recount_status: header bounds first, then the status of the
// highest-index failing step among [0, stepCount) -- 0 if none fail. A step
// beyond stepCount is stale and never considered.
export function validateCsMacro(
  m: CsMacro, nouns: readonly CsNounCaps[], groups: readonly (CsGroup | null)[] = [],
): number {
  const headerStatus = validateCsMacroHeader(m);
  if (headerStatus !== 0x00) return headerStatus;
  let worst = 0x00;
  for (let k = 0; k < m.stepCount; k++) {
    const status = validateCsMacroStep(m.steps[k], nouns, groups);
    if (status !== 0x00) worst = status;
  }
  return worst;
}

// fw control_surfaces_apply_display_cfg's order. Wire fields are u8/u16 on
// the device; the explicit range checks below are the client-side guard for
// values a caller might hand in out of that band (the wire codec would
// truncate them silently otherwise).
export function validateCsDisplayCfg(c: CsDisplayCfg): number {
  if (c.mode < 0 || c.mode > CsDisplayMode.CycleAll) return 0x14;         // INVALID_VALUE
  if (c.homePage < 0 || c.homePage >= CS_MAX_DISPLAY_PAGES) return 0x25;  // INVALID_PAGE
  if (c.dwell < 0 || c.dwell > 0xFFFF) return 0x14;
  if (c.overlayHold < 0 || c.overlayHold > 0xFFFF) return 0x14;
  if (c.brightness < 0 || c.brightness > 255) return 0x14;
  if (c.flags & ~CS_DCFG_KNOWN_FLAGS) return 0x14;
  const labelAlign = (c.flags >> CS_DCFG_LABEL_ALIGN_SHIFT) & CS_DCFG_ALIGN_MASK;
  const valueAlign = (c.flags >> CS_DCFG_VALUE_ALIGN_SHIFT) & CS_DCFG_ALIGN_MASK;
  if (labelAlign > CsDisplayAlign.Right || valueAlign > CsDisplayAlign.Right) return 0x14;
  if (c.editTimeout < 0 || c.editTimeout > 0xFFFF) return 0x14;
  if (c.mode !== CsDisplayMode.Fixed && c.dwell < 10) return 0x14;
  return 0x00;
}

// A BAR page (and the panel's BAR toggle) only make sense on a continuous
// noun with a real min..max span -- a degenerate 0..0 range has nothing to
// draw a bar against.
export function csNounHasSpan(noun: CsNounCaps): boolean {
  return noun.kind === CsKind.Continuous && noun.maxQ8 > noun.minQ8;
}

// fw disp_validate_page's order exactly. A page is a no-op without a live
// display, so this never checks anything device-state-dependent.
export function validateCsDisplayPage(
  p: CsDisplayPage, nouns: readonly CsNounCaps[], groups: readonly (CsGroup | null)[] = [],
): number {
  if (!(p.flags & CS_DPAGE_ACTIVE)) {
    return (p.noun !== 0 || p.target !== 0 || p.index !== 0 || p.flags !== 0) ? 0x25 : 0x00;  // INVALID_PAGE
  }
  if (p.flags & ~CS_DPAGE_KNOWN_FLAGS) return 0x25;
  if (p.noun >= nouns.length) return 0x12;                                                    // INVALID_NOUN

  const noun = nouns[p.noun];
  if ((p.flags & CS_DPAGE_BAR) && !csNounHasSpan(noun)) return 0x25;
  if (p.noun === CsNoun.DisplayPage || p.noun === CsNoun.DisplayEdit || p.noun === CsNoun.PageValue) return 0x25;
  if (noun.actions === 0) return 0x12;                                                        // platform-unavailable

  return (p.flags & CS_DPAGE_GROUP) ? validateCsGroupRef(p, noun, groups) : validateCsTarget(p, noun);
}
