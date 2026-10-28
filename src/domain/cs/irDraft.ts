// Draft logic for the IR remote's learned commands (control_surfaces_spec.md
// 3.6), modeled on draft.ts/macroDraft.ts: display units in the draft,
// wire units only at the buildIrCommand boundary. The noun/action option
// lists are draft.ts's, scoped to the IR type descriptor.
import * as Domain from '@/domain';
import * as CsUnit from './unitDisplay';
import * as CsField from './fieldHelpers';
import * as CsDraft from './draft';

export interface IrDraft {
  noun: number; action: number;
  target: number; index: number;
  protocol: number; code: number;
  value: number; step: number;
  wrap: boolean; repeat: boolean;
  // Caps v10+: target is a group index instead of a channel.
  grouped: boolean;
}

export const IR_STEPPY: readonly number[] = [Domain.CsAction.Inc, Domain.CsAction.Dec];

export function irNounOptions(caps: Domain.CsCaps | null, nouns: readonly Domain.CsNounCaps[]): number[] {
  return CsDraft.nounOptionsFor(Domain.CsType.Ir, caps, nouns);
}

export function irActionOptions(
  caps: Domain.CsCaps | null, nouns: readonly Domain.CsNounCaps[], noun: number,
): Domain.CsAction[] {
  return CsDraft.actionOptionsFor(Domain.CsType.Ir, noun, caps, nouns);
}

// GROUP joins the allowed IR flag set at caps v10 (v9 firmware rejects it).
export function irGroupsAvailable(caps: Domain.CsCaps | null): boolean {
  return CsField.groupsAvailable(caps) && (caps?.capsVersion ?? 0) >= 10;
}

export function defaultIrOperands(d: IrDraft, nouns: readonly Domain.CsNounCaps[]): void {
  const noun = nouns[d.noun];
  const cont = noun?.kind === Domain.CsKind.Continuous;
  const bool = noun?.kind === Domain.CsKind.Bool;
  const unit = noun?.unit ?? Domain.CS_UNIT_NONE;
  d.step = !IR_STEPPY.includes(d.action) ? 0 : CsUnit.isLogStep(unit) ? 0 : 1;
  if (d.action === Domain.CsAction.Set || d.action === Domain.CsAction.Momentary) {
    d.value = noun && cont ? CsUnit.valueToDisplay(unit, noun.maxQ8) : bool ? 1 : 0;
  } else {
    d.value = 0;
  }
  d.wrap = false;
  d.repeat = false;
}

export function defaultIrDraft(caps: Domain.CsCaps | null, nouns: readonly Domain.CsNounCaps[]): IrDraft {
  const noun = irNounOptions(caps, nouns)[0] ?? Domain.CsNoun.UserVolume;
  const d: IrDraft = {
    noun, action: CsDraft.defaultAction(Domain.CsType.Ir, noun, caps, nouns), target: 0, index: 0,
    protocol: Domain.CsIrProto.None, code: 0, value: 0, step: 0, wrap: false, repeat: false,
    grouped: false,
  };
  defaultIrOperands(d, nouns);
  return d;
}

export function irDraftFromLive(c: Domain.CsIrCommand, nouns: readonly Domain.CsNounCaps[]): IrDraft {
  const noun = nouns[c.noun];
  const cont = noun?.kind === Domain.CsKind.Continuous;
  const unit = noun?.unit ?? Domain.CS_UNIT_NONE;
  return {
    noun: c.noun, action: c.action, target: c.target, index: c.index,
    protocol: c.protocol, code: c.code,
    value: cont ? CsUnit.valueToDisplay(unit, c.value) : c.value,
    step: cont ? CsUnit.stepToDisplay(unit, c.step) : c.step,
    wrap: (c.flags & Domain.CS_FLAG_WRAP) !== 0,
    repeat: (c.flags & Domain.CS_FLAG_REPEAT) !== 0,
    grouped: (c.flags & Domain.CS_FLAG_GROUP) !== 0,
  };
}

export function buildIrCommand(
  d: IrDraft, nouns: readonly Domain.CsNounCaps[], caps: Domain.CsCaps | null,
): Domain.CsIrCommand {
  const cont = CsField.contOf(nouns, d.noun);
  const unit = CsField.unitOf(nouns, d.noun);
  const repeatEligible = d.action === Domain.CsAction.Inc || d.action === Domain.CsAction.Dec;
  const grouped = irGroupsAvailable(caps) && CsField.showTargetOf(nouns, d.noun) && d.grouped;
  // PAGE_VALUE carries no operand of its own -- the firmware rejects any
  // value/step on it (same rule as buildBinding).
  const pageValue = d.noun === Domain.CsNoun.PageValue;
  return {
    noun: d.noun as Domain.CsNoun,
    action: d.action as Domain.CsAction,
    flags: (CsField.showWrapOf(nouns, d.noun, d.action, IR_STEPPY) && d.wrap ? Domain.CS_FLAG_WRAP : 0)
      | (repeatEligible && d.repeat ? Domain.CS_FLAG_REPEAT : 0)
      | (grouped ? Domain.CS_FLAG_GROUP : 0),
    target: CsField.showTargetOf(nouns, d.noun) ? d.target : 0,
    index: CsField.showBandOf(nouns, d.noun) ? d.index : 0,
    protocol: d.protocol as Domain.CsIrProto,
    value: pageValue ? 0 : CsField.showValueOf(d.action) ? (cont ? CsUnit.displayToValue(unit, d.value) : Math.round(d.value)) : 0,
    step: pageValue ? 0 : CsField.showStepOf(d.action, IR_STEPPY) ? CsField.clampStep(cont ? CsUnit.displayToStep(unit, d.step) : Math.round(d.step)) : 0,
    code: d.code,
  };
}

export function irCommandsEqual(a: Domain.CsIrCommand, b: Domain.CsIrCommand): boolean {
  return a.noun === b.noun && a.action === b.action && a.flags === b.flags
    && a.target === b.target && a.index === b.index && a.protocol === b.protocol
    && a.value === b.value && a.step === b.step && a.code === b.code;
}
