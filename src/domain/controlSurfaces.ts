// Control Surfaces (fw 1.1.5, wire V16+, caps v3): user-wired physical
// controls and indicators (buttons, switches, pots, encoders, LEDs, PWM
// LEDs, an IR remote receiver) on spare GPIOs, configured over vendor
// commands 0x84-0x8F, 0x9D-0x9E. Which (type, noun, action) combinations
// are legal comes from the device-served caps tables read at connect
// (GetCsCaps), never from hardcoded masks; this module holds the wire
// enums, q8.8 helpers, UI labels, and the client-side pre-validation that
// mirrors the firmware's own check order.
//
// Binding and slot-name SETs are live-only previews: CS_SAVE persists the
// whole live config to flash, CS_REVERT discards the preview and re-applies
// the stored one. `CsStatus.dirty` reports whether the two differ. IR
// commands (sub-slots of the single IR container binding) follow the same
// preview/save/revert model.

export const CsType = {
  None:    0,
  Button:  1,
  Switch:  2,
  Pot:     3,
  Encoder: 4,
  Led:     5,
  LedPwm:  6,
  Ir:      7,
} as const;
export type CsType = (typeof CsType)[keyof typeof CsType];

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
// Bits above REPEAT are reserved; firmware rejects them with INVALID_VALUE.
export const CS_KNOWN_FLAGS  = CS_FLAG_INVERT | CS_FLAG_REVERSE | CS_FLAG_WRAP | CS_FLAG_ACCEL | CS_FLAG_REPEAT;

export const CS_MAX_BINDINGS = 16;
export const CS_GPIO_UNUSED  = 0xFF;
export const CS_NAME_MAX_LEN = 31;   // bytes, UTF-8 (32-byte NUL-terminated window)

export const CS_MAX_IR_COMMANDS = 8;

// GetCsStatus.irLearnState / the CsIrLearn(wValue=2) result read.
export const CS_IR_LEARN_IDLE    = 0;
export const CS_IR_LEARN_ARMED   = 1;
export const CS_IR_LEARN_DONE    = 2;
export const CS_IR_LEARN_TIMEOUT = 3;

export const CS_PINCLASS_ANY = 0;
export const CS_PINCLASS_ADC = 1;

// Value units (CsNounDesc.unit). Fixes both the wire encoding of
// value/range_min/range_max and the stepping law (see the q8.8 helpers below).
export const CS_UNIT_NONE    = 0;   // bool/enum: plain integers
export const CS_UNIT_DB      = 1;   // 8.8 signed dB; linear stepping
export const CS_UNIT_HZ      = 2;   // plain integer Hz; log stepping (8.8-octave step)
export const CS_UNIT_Q       = 3;   // 8.8 Q; log stepping (8.8-octave step)
export const CS_UNIT_PERCENT = 4;   // 8.8 percent; linear stepping

// Target kinds (CsNounDesc.targetKind); what CsBinding.target addresses.
export const CS_TARGET_NONE      = 0;   // target/index ignored
export const CS_TARGET_INPUT_CH  = 1;   // target = input channel (0..targetCount-1)
export const CS_TARGET_OUTPUT_CH = 2;   // target = output channel (0..targetCount-1)
export const CS_TARGET_DSP_CH    = 3;   // target = DSP channel (inputs then outputs)
export const CS_TARGET_DSP_BAND  = 4;   // target = DSP channel, index = filter band

// Noun descriptor flags (CsNounDesc.dflags)
export const CS_NDF_DEFERRED = 0x01;   // apply is deferred; engine steps from a target shadow

// ADC-capable GPIOs on both platforms (GPIO 29 is the VSYS monitor, excluded).
export const CS_ADC_PINS: readonly number[] = [26, 27, 28];

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
  target: number;
  index: number;
  value: number;
  step: number;
  rangeMin: number;
  rangeMax: number;
}

// A cleared slot is the ALL-ZERO 24-byte blob -- gpio1 is 0 here, not
// 0xFF/null (the 0xFF sentinel marks the unused second pin of a CONFIGURED
// single-pin binding; a cleared slot has no pins at all).
export const EMPTY_CS_BINDING: CsBinding = {
  type: CsType.None, noun: CsNoun.UserVolume, action: CsAction.Adjust, flags: 0,
  gpio0: 0, gpio1: 0, event: CsEvent.Press, target: 0, index: 0,
  value: 0, step: 0, rangeMin: 0, rangeMax: 0,
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
};

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
): ({ gpio0: number; gpio1: number | null } | null)[] {
  return bindings.map((b, i) =>
    b && status && (status.activeMask & (1 << i))
      ? { gpio0: b.gpio0, gpio1: b.gpio1 }
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

// Client-side pre-validation mirroring the firmware's cs_validate() order:
// type -> noun -> action -> flags -> (IR container fields | action-allowed-
// by-both-masks -> event -> repeat/accel flags -> target -> value/step/range
// bounds) -> pin class/shape. Returns 0 on success or the CS_STATUS_* /
// PIN_CONFIG_* byte the firmware would produce. Checks that need cross-
// binding or device state (pin conflicts, PWM slice sharing, one-IR-per-
// device) stay with the caller -- they are device truth, not table truth.
export function validateCsBinding(
  b: CsBinding, caps: CsCaps, nouns: readonly CsNounCaps[],
): number {
  if (b.type === CsType.None) return 0x00;                       // clear is always valid
  if (b.type >= caps.types.length) return 0x11;                  // INVALID_TYPE
  if (b.noun >= nouns.length) return 0x12;                       // INVALID_NOUN
  if (b.action >= CS_ACTION_COUNT) return 0x13;                  // INVALID_ACTION
  if (b.flags & ~CS_KNOWN_FLAGS) return 0x14;                    // INVALID_VALUE (unknown flags)

  const type = caps.types[b.type];
  const noun = nouns[b.noun];

  if (b.type === CsType.Ir) {
    // Container slot: the receiver pin and its idle sense (INVERT) are the
    // only payload; everything else must read as the empty binding.
    if (b.noun !== 0 || b.action !== 0 || b.event !== CsEvent.Press ||
        b.target !== 0 || b.index !== 0 ||
        b.value !== 0 || b.step !== 0 || b.rangeMin !== 0 || b.rangeMax !== 0)
      return 0x14;
    if (b.flags & ~CS_FLAG_INVERT) return 0x14;
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

    const targetStatus = validateCsTarget(b, noun);
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
  if (cmd.flags & ~(CS_FLAG_WRAP | CS_FLAG_REPEAT)) return 0x14;  // INVALID_VALUE (unknown flags)

  const irType = caps.types[CsType.Ir];
  const noun = nouns[cmd.noun];
  if (!irType || !(irType.actions & noun.actions & (1 << cmd.action))) return 0x13; // INVALID_ACTION

  if ((cmd.flags & CS_FLAG_REPEAT) && cmd.action !== CsAction.Inc && cmd.action !== CsAction.Dec)
    return 0x14;                                                  // INVALID_VALUE (REPEAT: INC/DEC only)

  const targetStatus = validateCsTarget(cmd, noun);
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
