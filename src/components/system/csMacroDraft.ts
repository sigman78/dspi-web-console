// Per-macro/per-step draft logic for the MACROS panel (caps v9+), modeled on
// csDraft.ts (bindings) and the IrDraft logic inside CsIrCommands.svelte: a
// macro step is a stripped IR command (no protocol/code) plus a pre-delay.
// Explicit-arg, like csDraft.ts -- the panel owns drafts/applying and passes
// its own caps/nouns rather than this module reaching into session state.
import * as Domain from '@/domain';
import * as Clamp from '@/domain/clamp';
import * as CsUnit from './csUnitDisplay';
import * as CsField from './csFieldHelpers';

// Display units in the draft (see Draft/IrDraft); wire units only at
// buildMacroStep's boundary. preDelay is seconds; wire is 10 ms units.
export interface StepDraft {
  noun: number; action: number; target: number; index: number;
  grouped: boolean; wrap: boolean;
  value: number; step: number;
  preDelay: number;
}

// steps is the executed list (<= CS_MAX_MACRO_STEPS); a stale wire tail never
// makes it into a draft (see macroDraftFromLive).
export interface MacroDraft {
  name: string;
  steps: StepDraft[];
}

export const MACRO_STEPPY: readonly number[] = [Domain.CsAction.Inc, Domain.CsAction.Dec];

// Preference order for the default action on a freshly picked noun.
const STEP_ACTION_PREF: readonly Domain.CsAction[] = [
  Domain.CsAction.Set, Domain.CsAction.Toggle, Domain.CsAction.Trigger, Domain.CsAction.Inc, Domain.CsAction.Dec,
];

export function stepNounOptions(nouns: readonly Domain.CsNounCaps[]): number[] {
  return nouns.map((_, i) => i).filter((i) =>
    (nouns[i].actions & Domain.CS_MACRO_STEP_ACTIONS) !== 0 &&
    nouns[i].unit <= Domain.CS_MAX_KNOWN_UNIT &&
    i !== Domain.CsNoun.Macro && i !== Domain.CsNoun.PageValue);
}

export function stepActionOptions(nouns: readonly Domain.CsNounCaps[], noun: number): Domain.CsAction[] {
  return Domain.legalActions(Domain.CS_MACRO_STEP_ACTIONS, nouns[noun]?.actions ?? 0);
}

export function defaultStepAction(nouns: readonly Domain.CsNounCaps[], noun: number): number {
  const legal = stepActionOptions(nouns, noun);
  for (const a of STEP_ACTION_PREF) if (legal.includes(a)) return a;
  return legal[0] ?? 0;
}

export function defaultStepOperands(d: StepDraft, nouns: readonly Domain.CsNounCaps[]): void {
  const noun = nouns[d.noun];
  const cont = noun?.kind === Domain.CsKind.Continuous;
  const bool = noun?.kind === Domain.CsKind.Bool;
  const unit = noun?.unit ?? Domain.CS_UNIT_NONE;
  d.step = !MACRO_STEPPY.includes(d.action) ? 0 : CsUnit.isLogStep(unit) ? 0 : 1;
  if (d.action === Domain.CsAction.Set) {
    d.value = noun && cont ? CsUnit.valueToDisplay(unit, noun.maxQ8) : bool ? 1 : 0;
  } else {
    d.value = 0;
  }
  d.wrap = false;
}

export function defaultStepDraft(nouns: readonly Domain.CsNounCaps[]): StepDraft {
  const noun = stepNounOptions(nouns)[0] ?? Domain.CsNoun.UserVolume;
  const d: StepDraft = {
    noun, action: defaultStepAction(nouns, noun), target: 0, index: 0,
    grouped: false, wrap: false, value: 0, step: 0, preDelay: 0,
  };
  defaultStepOperands(d, nouns);
  return d;
}

export function stepDraftFromLive(s: Domain.CsMacroStep, nouns: readonly Domain.CsNounCaps[]): StepDraft {
  const noun = nouns[s.noun];
  const cont = noun?.kind === Domain.CsKind.Continuous;
  const unit = noun?.unit ?? Domain.CS_UNIT_NONE;
  return {
    noun: s.noun, action: s.action, target: s.target, index: s.index,
    grouped: (s.flags & Domain.CS_FLAG_GROUP) !== 0,
    wrap: (s.flags & Domain.CS_FLAG_WRAP) !== 0,
    value: cont ? CsUnit.valueToDisplay(unit, s.value) : s.value,
    step: cont ? CsUnit.stepToDisplay(unit, s.step) : s.step,
    preDelay: s.preDelay / 100,
  };
}

// Steps carry GROUP from caps v9 (no extra v10 gate like IR commands), so
// grouping is gated only on the noun having a target, not on groupsAvailable.
export function buildMacroStep(d: StepDraft, nouns: readonly Domain.CsNounCaps[]): Domain.CsMacroStep {
  const cont = CsField.contOf(nouns, d.noun);
  const unit = CsField.unitOf(nouns, d.noun);
  const grouped = CsField.showTargetOf(nouns, d.noun) && d.grouped;
  return {
    noun: d.noun as Domain.CsNoun,
    action: d.action as Domain.CsAction,
    flags: (grouped ? Domain.CS_FLAG_GROUP : 0)
      | (CsField.showWrapOf(nouns, d.noun, d.action, MACRO_STEPPY) && d.wrap ? Domain.CS_FLAG_WRAP : 0),
    target: CsField.showTargetOf(nouns, d.noun) ? d.target : 0,
    index: CsField.showBandOf(nouns, d.noun) ? d.index : 0,
    value: CsField.showValueOf(d.action) ? (cont ? CsUnit.displayToValue(unit, d.value) : Math.round(d.value)) : 0,
    step: CsField.showStepOf(d.action, MACRO_STEPPY) ? (cont ? CsUnit.displayToStep(unit, d.step) : Math.round(d.step)) : 0,
    preDelay: Clamp.toRange(Math.round(d.preDelay * 100), 0, 0xFFFF),
  };
}

export function macroDraftFromLive(m: Domain.CsMacro, nouns: readonly Domain.CsNounCaps[]): MacroDraft {
  return {
    name: m.name,
    steps: m.steps.slice(0, m.stepCount).map((s) => stepDraftFromLive(s, nouns)),
  };
}

export function buildMacro(d: MacroDraft, nouns: readonly Domain.CsNounCaps[]): Domain.CsMacro {
  const stepCount = Math.min(d.steps.length, Domain.CS_MAX_MACRO_STEPS);
  const steps = Array.from({ length: Domain.CS_MAX_MACRO_STEPS }, (_, i) =>
    i < stepCount ? buildMacroStep(d.steps[i], nouns) : { ...Domain.EMPTY_CS_MACRO_STEP });
  return { name: d.name, stepCount, steps };
}

function macroStepsEqual(a: Domain.CsMacroStep, b: Domain.CsMacroStep): boolean {
  return a.noun === b.noun && a.action === b.action && a.flags === b.flags
    && a.target === b.target && a.index === b.index
    && a.value === b.value && a.step === b.step && a.preDelay === b.preDelay;
}

// Only steps[0..stepCount) are compared -- a stale tail step never affects
// dirty-checking, same as validateCsMacro/csMacroIsEmpty.
export function macrosEqual(a: Domain.CsMacro, b: Domain.CsMacro): boolean {
  if (a.name !== b.name || a.stepCount !== b.stepCount) return false;
  for (let i = 0; i < a.stepCount; i++) {
    if (!macroStepsEqual(a.steps[i], b.steps[i])) return false;
  }
  return true;
}
