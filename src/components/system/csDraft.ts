// Per-slot binding-draft logic shared between the binding editor's parent
// (ControlSurfacesPanel, which owns `drafts`/`applying` and the apply/revert/
// remove/rename/save/discard actions) and the per-slot row it renders
// (CsBindingRow, a controlled component with no draft state of its own).
// Explicit-arg, like csFieldHelpers.ts: callers pass their own local caps/
// nouns rather than this module reaching into session state.
import * as Domain from '@/domain';
import * as CsUnit from './csUnitDisplay';
import * as CsField from './csFieldHelpers';

// Per-slot local drafts (display units: unit-converted per noun -- dB/%/Q,
// plain Hz, or ints for bool/enum; conversion happens once, in buildBinding).
// A slot is "configured" when it has a live binding or a local draft; only
// those render. Controls edit the draft; APPLY sends it.
export interface Draft {
  type: number; noun: number; action: number; event: number;
  gpio0: number; gpio1: number;
  target: number; index: number;
  invert: boolean; reverse: boolean; wrap: boolean; accel: boolean; repeat: boolean;
  value: number; step: number;
  limitRange: boolean; rangeMin: number; rangeMax: number;
  // Opaque wire bytes from the live binding (newer-caps fields this console
  // can't author); carried so an edit round-trip preserves them.
  opaque0?: number; opaqueTail?: readonly number[];
}

export const STEPPY: readonly number[] = [Domain.CsAction.Step, Domain.CsAction.Inc, Domain.CsAction.Dec];

// Per-type action preference (desktop-app order); first legal one wins.
export const ACTION_PREF: Partial<Record<number, readonly Domain.CsAction[]>> = {
  [Domain.CsType.Pot]:     [Domain.CsAction.Adjust],
  [Domain.CsType.Encoder]: [Domain.CsAction.Step],
  [Domain.CsType.Switch]:  [Domain.CsAction.Follow],
  [Domain.CsType.Led]:     [Domain.CsAction.IndEquals],
  [Domain.CsType.LedPwm]:  [Domain.CsAction.IndLevel, Domain.CsAction.IndEquals],
  [Domain.CsType.Button]:  [Domain.CsAction.Toggle, Domain.CsAction.Trigger, Domain.CsAction.Inc, Domain.CsAction.Set, Domain.CsAction.Dec],
};

export function nounOptionsFor(typeIdx: number, caps: Domain.CsCaps | null, nouns: readonly Domain.CsNounCaps[]): number[] {
  if (!caps) return [];
  const mask = caps.types[typeIdx]?.actions ?? 0;
  // A unit above CS_MAX_KNOWN_UNIT is from a newer caps format this console
  // can't encode -- offering the noun would write mis-scaled values.
  return nouns.map((_, i) => i).filter((i) =>
    (nouns[i].actions & mask) !== 0 && nouns[i].unit <= Domain.CS_MAX_KNOWN_UNIT);
}

export function actionOptionsFor(
  typeIdx: number, nounIdx: number, caps: Domain.CsCaps | null, nouns: readonly Domain.CsNounCaps[],
): Domain.CsAction[] {
  if (!caps) return [];
  return Domain.legalActions(caps.types[typeIdx]?.actions ?? 0, nouns[nounIdx]?.actions ?? 0);
}

export function defaultAction(
  typeIdx: number, nounIdx: number, caps: Domain.CsCaps | null, nouns: readonly Domain.CsNounCaps[],
): number {
  const legal = actionOptionsFor(typeIdx, nounIdx, caps, nouns);
  for (const a of ACTION_PREF[typeIdx] ?? []) if (legal.includes(a)) return a;
  return legal[0] ?? 0;
}

export function defaultOperands(d: Draft, nouns: readonly Domain.CsNounCaps[]): void {
  const noun = nouns[d.noun];
  const cont = noun?.kind === Domain.CsKind.Continuous;
  const bool = noun?.kind === Domain.CsKind.Bool;
  const unit = noun?.unit ?? Domain.CS_UNIT_NONE;
  // 0 = firmware default (1/12 octave); ms detents at 0.1 (whole ms is too
  // coarse for delay alignment, spec 2.1); else 1 unit/position.
  d.step = !STEPPY.includes(d.action) ? 0 : CsUnit.isLogStep(unit) ? 0 : unit === Domain.CS_UNIT_MS ? 0.1 : 1;
  if (d.action === Domain.CsAction.Set || d.action === Domain.CsAction.Momentary) {
    d.value = noun && cont ? CsUnit.valueToDisplay(unit, noun.maxQ8) : bool ? 1 : 0;
  } else if (d.action === Domain.CsAction.IndEquals) {
    d.value = bool ? 1 : 0;
  } else if (d.action === Domain.CsAction.IndAbove) {
    d.value = noun && cont ? CsUnit.valueToDisplay(unit, noun.maxQ8) : 0;
  } else {
    d.value = 0;
  }
  d.limitRange = false;
  d.rangeMin = noun && cont ? CsUnit.valueToDisplay(unit, noun.minQ8) : 0;
  d.rangeMax = noun && cont ? CsUnit.valueToDisplay(unit, noun.maxQ8) : 0;
}

export function draftFromLive(b: Domain.CsBinding, nouns: readonly Domain.CsNounCaps[]): Draft {
  const noun = nouns[b.noun];
  const cont = noun?.kind === Domain.CsKind.Continuous;
  const unit = noun?.unit ?? Domain.CS_UNIT_NONE;
  const limited = b.rangeMin !== 0 || b.rangeMax !== 0;
  return {
    type: b.type, noun: b.noun, action: b.action, event: b.event,
    gpio0: b.gpio0, gpio1: b.gpio1 ?? 0,
    target: b.target, index: b.index,
    invert: (b.flags & Domain.CS_FLAG_INVERT) !== 0,
    reverse: (b.flags & Domain.CS_FLAG_REVERSE) !== 0,
    wrap: (b.flags & Domain.CS_FLAG_WRAP) !== 0,
    accel: (b.flags & Domain.CS_FLAG_ACCEL) !== 0,
    repeat: (b.flags & Domain.CS_FLAG_REPEAT) !== 0,
    value: cont ? CsUnit.valueToDisplay(unit, b.value) : b.value,
    step: cont ? CsUnit.stepToDisplay(unit, b.step) : b.step,
    limitRange: limited,
    rangeMin: cont ? CsUnit.valueToDisplay(unit, limited ? b.rangeMin : noun?.minQ8 ?? 0) : 0,
    rangeMax: cont ? CsUnit.valueToDisplay(unit, limited ? b.rangeMax : noun?.maxQ8 ?? 0) : 0,
    opaque0: b.opaque0, opaqueTail: b.opaqueTail,
  };
}

// Draft predicates that don't already live in csFieldHelpers.ts -- these are
// specific to the GPIO binding shape (pins, reverse/accel/repeat flags), not
// shared with the IR command editor.
export function showRangeOf(d: Draft, nouns: readonly Domain.CsNounCaps[]): boolean {
  return (d.action === Domain.CsAction.Adjust || d.action === Domain.CsAction.IndLevel) && CsField.contOf(nouns, d.noun);
}
export function showReverseOf(d: Draft): boolean { return d.type === Domain.CsType.Pot || d.type === Domain.CsType.Encoder; }
export function showAccelOf(d: Draft): boolean { return d.type === Domain.CsType.Encoder; }
export function showRepeatOf(d: Draft): boolean {
  return d.type === Domain.CsType.Button && (d.action === Domain.CsAction.Inc || d.action === Domain.CsAction.Dec);
}
export function twoPins(d: Draft, caps: Domain.CsCaps | null): boolean { return caps?.types[d.type]?.pinCount === 2; }
export function adcOnly(d: Draft, caps: Domain.CsCaps | null): boolean {
  return caps?.types[d.type]?.pinClass === Domain.CS_PINCLASS_ADC;
}

export function buildBinding(d: Draft, nouns: readonly Domain.CsNounCaps[], caps: Domain.CsCaps | null): Domain.CsBinding {
  if (d.type === Domain.CsType.Ir) {
    return {
      type: Domain.CsType.Ir, noun: 0 as Domain.CsNoun, action: 0 as Domain.CsAction,
      flags: d.invert ? Domain.CS_FLAG_INVERT : 0,
      gpio0: d.gpio0, gpio1: null, event: Domain.CsEvent.Press,
      target: 0, index: 0, value: 0, step: 0, rangeMin: 0, rangeMax: 0,
      opaque0: d.opaque0, opaqueTail: d.opaqueTail,
    };
  }
  const cont = CsField.contOf(nouns, d.noun);
  const unit = CsField.unitOf(nouns, d.noun);
  const forcedPress = d.action === Domain.CsAction.Momentary || d.repeat;
  const event = d.type === Domain.CsType.Button ? (forcedPress ? Domain.CsEvent.Press : (d.event as Domain.CsEvent)) : Domain.CsEvent.Press;
  return {
    type: d.type as Domain.CsType,
    noun: d.noun as Domain.CsNoun,
    action: d.action as Domain.CsAction,
    flags: (d.invert ? Domain.CS_FLAG_INVERT : 0)
      | (showReverseOf(d) && d.reverse ? Domain.CS_FLAG_REVERSE : 0)
      | (CsField.showWrapOf(nouns, d.noun, d.action, STEPPY) && d.wrap ? Domain.CS_FLAG_WRAP : 0)
      | (showAccelOf(d) && d.accel ? Domain.CS_FLAG_ACCEL : 0)
      | (showRepeatOf(d) && d.repeat ? Domain.CS_FLAG_REPEAT : 0),
    gpio0: d.gpio0,
    gpio1: twoPins(d, caps) ? d.gpio1 : null,
    event,
    target: CsField.showTargetOf(nouns, d.noun) ? d.target : 0,
    index: CsField.showBandOf(nouns, d.noun) ? d.index : 0,
    value: CsField.showValueOf(d.action) ? (cont ? CsUnit.displayToValue(unit, d.value) : Math.round(d.value)) : 0,
    step: CsField.showStepOf(d.action, STEPPY) ? (cont ? CsUnit.displayToStep(unit, d.step) : Math.round(d.step)) : 0,
    rangeMin: showRangeOf(d, nouns) && d.limitRange ? CsUnit.displayToValue(unit, d.rangeMin) : 0,
    rangeMax: showRangeOf(d, nouns) && d.limitRange ? CsUnit.displayToValue(unit, d.rangeMax) : 0,
    opaque0: d.opaque0, opaqueTail: d.opaqueTail,
  };
}

export function bindingsEqual(a: Domain.CsBinding, b: Domain.CsBinding): boolean {
  return a.type === b.type && a.noun === b.noun && a.action === b.action
    && a.flags === b.flags && a.gpio0 === b.gpio0
    && (a.gpio1 ?? null) === (b.gpio1 ?? null)
    && a.event === b.event && a.target === b.target && a.index === b.index
    && a.value === b.value && a.step === b.step
    && a.rangeMin === b.rangeMin && a.rangeMax === b.rangeMax;
}
