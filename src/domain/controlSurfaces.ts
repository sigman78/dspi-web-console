// Control Surfaces (fw 1.1.5, wire V16+): user-wired physical controls and
// indicators (buttons, switches, pots, encoders, LEDs) on spare GPIOs,
// configured over vendor commands 0x84-0x87. Which (type, noun, action)
// combinations are legal comes from the device-served caps tables read at
// connect (GetCsCaps), never from hardcoded masks; this module holds the wire
// enums, q8.8 helpers, UI labels, and the client-side pre-validation that
// mirrors the firmware's own check order.

export const CsType = {
  None:    0,
  Button:  1,
  Switch:  2,
  Pot:     3,
  Encoder: 4,
  Led:     5,
} as const;
export type CsType = (typeof CsType)[keyof typeof CsType];

export const CsNoun = {
  UserVolume:   0,
  MasterVolume: 1,
  UserMute:     2,
  Loudness:     3,
  Crossfeed:    4,
  Leveller:     5,
  Preset:       6,
  InputSource:  7,
  Clip:         8,
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
} as const;
export type CsAction = (typeof CsAction)[keyof typeof CsAction];

export const CsKind = {
  Continuous: 0,
  Bool:       1,
  Enum:       2,
} as const;
export type CsKind = (typeof CsKind)[keyof typeof CsKind];

export const CS_FLAG_INVERT  = 0x01;
export const CS_FLAG_REVERSE = 0x02;
export const CS_FLAG_WRAP    = 0x04;
// Bits above WRAP are reserved; firmware rejects them with INVALID_VALUE.
export const CS_KNOWN_FLAGS  = CS_FLAG_INVERT | CS_FLAG_REVERSE | CS_FLAG_WRAP;

export const CS_MAX_BINDINGS = 8;
export const CS_GPIO_UNUSED  = 0xFF;

export const CS_PINCLASS_ANY = 0;
export const CS_PINCLASS_ADC = 1;

// ADC-capable GPIOs on both platforms (GPIO 29 is the VSYS monitor, excluded).
export const CS_ADC_PINS: readonly number[] = [26, 27, 28];

// One binding, host shape. gpio1 is null unless the type takes two pins;
// continuous value/step/range fields stay in raw q8.8 (conversion belongs to
// the edit boundary, not the stored config).
export interface CsBinding {
  type: CsType;
  noun: CsNoun;
  action: CsAction;
  flags: number;
  gpio0: number;
  gpio1: number | null;
  value: number;
  step: number;
  rangeMin: number;
  rangeMax: number;
}

// A cleared slot is the ALL-ZERO 16-byte blob -- gpio1 is 0 here, not
// 0xFF/null (the 0xFF sentinel marks the unused second pin of a CONFIGURED
// single-pin binding; a cleared slot has no pins at all).
export const EMPTY_CS_BINDING: CsBinding = {
  type: CsType.None, noun: CsNoun.UserVolume, action: CsAction.Adjust, flags: 0,
  gpio0: 0, gpio1: 0, value: 0, step: 0, rangeMin: 0, rangeMax: 0,
};

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
}

export interface CsNounCaps {
  kind: CsKind;
  enumCount: number;
  actions: number;
  minQ8: number;
  maxQ8: number;
}

// GetCsStatus packet, host shape.
export interface CsStatus {
  lastStatus: number;
  lastSlot: number;
  maxBindings: number;
  activeMask: number;
  slotStatus: number[];
}

// Signed 8.8 fixed-point dB (1.0 dB = 256).
export function dbToQ8(db: number): number {
  return Math.round(db * 256);
}

export function q8ToDb(q8: number): number {
  return q8 / 256;
}

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
};

export const CS_NOUN_LABEL: Record<CsNoun, string> = {
  [CsNoun.UserVolume]:   'Volume',
  [CsNoun.MasterVolume]: 'Master Volume',
  [CsNoun.UserMute]:     'Mute',
  [CsNoun.Loudness]:     'Loudness',
  [CsNoun.Crossfeed]:    'Crossfeed',
  [CsNoun.Leveller]:     'Volume Leveller',
  [CsNoun.Preset]:       'Preset',
  [CsNoun.InputSource]:  'Input Source',
  [CsNoun.Clip]:         'Clip Indicator',
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

// Client-side pre-validation mirroring the firmware's cs_validate() order:
// type -> noun -> action-allowed-by-both-masks -> flags/value/step/range
// bounds -> pin class/shape. Returns 0 on success or the CS_STATUS_* /
// PIN_CONFIG_* byte the firmware would produce. Pin CONFLICT checks (in-use
// by another peripheral or binding) stay with the caller -- they are device
// truth, not table truth.
export function validateCsBinding(
  b: CsBinding, caps: CsCaps, nouns: readonly CsNounCaps[],
): number {
  if (b.type === CsType.None) return 0x00;                       // clear is always valid
  if (b.type >= caps.types.length) return 0x11;                  // INVALID_TYPE
  if (b.noun >= nouns.length) return 0x12;                       // INVALID_NOUN
  const type = caps.types[b.type];
  const noun = nouns[b.noun];
  if (b.action > 15 || !(type.actions & noun.actions & (1 << b.action))) return 0x13; // INVALID_ACTION
  if (b.flags & ~CS_KNOWN_FLAGS) return 0x14;                    // INVALID_VALUE (unknown flags)
  if (b.step < 0) return 0x14;
  if (b.action === CsAction.Set || b.action === CsAction.IndEquals) {
    if (noun.kind === CsKind.Continuous && (b.value < noun.minQ8 || b.value > noun.maxQ8)) return 0x14;
    if (noun.kind === CsKind.Bool && b.value !== 0 && b.value !== 1) return 0x14;
    if (noun.kind === CsKind.Enum && (b.value < 0 || b.value >= noun.enumCount)) return 0x14;
  }
  if (b.rangeMin !== 0 || b.rangeMax !== 0) {
    if (noun.kind !== CsKind.Continuous) return 0x14;
    if (b.rangeMin >= b.rangeMax) return 0x14;
    if (b.rangeMin < noun.minQ8 || b.rangeMax > noun.maxQ8) return 0x14;
  }
  if (type.pinClass === CS_PINCLASS_ADC && !CS_ADC_PINS.includes(b.gpio0)) return 0x15; // PIN_NOT_ADC
  if (type.pinCount === 2 && (b.gpio1 == null || b.gpio1 === b.gpio0)) return 0x01;     // INVALID_PIN
  return 0x00;
}
