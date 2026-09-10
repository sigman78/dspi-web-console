// Draft logic for the DISPLAY panel's two editors (caps v10+): the display's
// own settings blob (CfgDraft) and one page slot (PageDraft). Modeled on
// csDraft.ts/csMacroDraft.ts -- explicit-arg, display units in the draft
// (seconds where the wire carries 0.1 s ticks), wire units only at the
// buildCfg/buildPage boundary.
import * as Domain from '@/domain';
import * as Clamp from '@/domain/clamp';
import * as CsField from './csFieldHelpers';

export interface CfgDraft {
  mode: Domain.CsDisplayMode;
  homePage: number;
  dwell: number;          // seconds
  overlayHold: number;    // seconds
  brightness: number;
  overlayAny: boolean;
  editGated: boolean;
  labelAlign: Domain.CsDisplayAlign;
  valueAlign: Domain.CsDisplayAlign;
  editTimeout: number;    // seconds
}

export interface PageDraft {
  noun: number;
  target: number;
  index: number;
  grouped: boolean;
  large: boolean;
  bar: boolean;
}

export function cfgDraftFromLive(c: Domain.CsDisplayCfg): CfgDraft {
  return {
    mode: c.mode,
    homePage: c.homePage,
    dwell: c.dwell / 10,
    overlayHold: c.overlayHold / 10,
    brightness: c.brightness,
    overlayAny: (c.flags & Domain.CS_DCFG_OVERLAY_ANY) !== 0,
    editGated: (c.flags & Domain.CS_DCFG_EDIT_GATED) !== 0,
    labelAlign: ((c.flags >> Domain.CS_DCFG_LABEL_ALIGN_SHIFT) & Domain.CS_DCFG_ALIGN_MASK) as Domain.CsDisplayAlign,
    valueAlign: ((c.flags >> Domain.CS_DCFG_VALUE_ALIGN_SHIFT) & Domain.CS_DCFG_ALIGN_MASK) as Domain.CsDisplayAlign,
    editTimeout: c.editTimeout / 10,
  };
}

// homePage is carried through even outside Fixed mode -- the panel hides the
// picker there but the field stays whatever it last was, matching the wire
// shape (fw ignores it outside FIXED rather than rejecting a stale value).
export function buildCfg(d: CfgDraft): Domain.CsDisplayCfg {
  return {
    mode: d.mode,
    homePage: d.homePage,
    dwell: Clamp.toRange(Math.round(d.dwell * 10), 0, 0xFFFF),
    overlayHold: Clamp.toRange(Math.round(d.overlayHold * 10), 0, 0xFFFF),
    brightness: Clamp.toRange(Math.round(d.brightness), 0, 255),
    flags: (d.overlayAny ? Domain.CS_DCFG_OVERLAY_ANY : 0)
      | (d.editGated ? Domain.CS_DCFG_EDIT_GATED : 0)
      | ((d.labelAlign & Domain.CS_DCFG_ALIGN_MASK) << Domain.CS_DCFG_LABEL_ALIGN_SHIFT)
      | ((d.valueAlign & Domain.CS_DCFG_ALIGN_MASK) << Domain.CS_DCFG_VALUE_ALIGN_SHIFT),
    editTimeout: Clamp.toRange(Math.round(d.editTimeout * 10), 0, 0xFFFF),
  };
}

export function cfgsEqual(a: Domain.CsDisplayCfg, b: Domain.CsDisplayCfg): boolean {
  return a.mode === b.mode && a.homePage === b.homePage && a.dwell === b.dwell
    && a.overlayHold === b.overlayHold && a.brightness === b.brightness
    && a.flags === b.flags && a.editTimeout === b.editTimeout;
}

export function defaultPageDraft(nouns: readonly Domain.CsNounCaps[]): PageDraft {
  const noun = CsField.pageNounOptions(nouns)[0]?.v ?? Domain.CsNoun.UserVolume;
  return { noun, target: 0, index: 0, grouped: false, large: false, bar: false };
}

export function pageDraftFromLive(p: Domain.CsDisplayPage): PageDraft {
  return {
    noun: p.noun, target: p.target, index: p.index,
    grouped: (p.flags & Domain.CS_DPAGE_GROUP) !== 0,
    large: (p.flags & Domain.CS_DPAGE_LARGE) !== 0,
    bar: (p.flags & Domain.CS_DPAGE_BAR) !== 0,
  };
}

export function buildPage(d: PageDraft, nouns: readonly Domain.CsNounCaps[]): Domain.CsDisplayPage {
  const grouped = CsField.showTargetOf(nouns, d.noun) && d.grouped;
  const noun = nouns[d.noun];
  const bar = !!noun && Domain.csNounHasSpan(noun) && d.bar;
  return {
    noun: d.noun as Domain.CsNoun,
    target: CsField.showTargetOf(nouns, d.noun) ? d.target : 0,
    index: CsField.showBandOf(nouns, d.noun) ? d.index : 0,
    flags: Domain.CS_DPAGE_ACTIVE
      | (grouped ? Domain.CS_DPAGE_GROUP : 0)
      | (d.large ? Domain.CS_DPAGE_LARGE : 0)
      | (bar ? Domain.CS_DPAGE_BAR : 0),
  };
}

export function pagesEqual(a: Domain.CsDisplayPage, b: Domain.CsDisplayPage): boolean {
  return a.noun === b.noun && a.target === b.target && a.index === b.index && a.flags === b.flags;
}
