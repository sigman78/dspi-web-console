import { describe, it, expect } from 'vitest';
import {
  CsKind, CsDisplayMode, CsDisplayAlign,
  CS_UNIT_NONE, CS_UNIT_DB, CS_TARGET_NONE, CS_TARGET_INPUT_CH,
  CS_DCFG_OVERLAY_ANY, CS_DCFG_EDIT_GATED, CS_DCFG_LABEL_ALIGN_SHIFT, CS_DCFG_VALUE_ALIGN_SHIFT,
  CS_DPAGE_ACTIVE, CS_DPAGE_GROUP, CS_DPAGE_LARGE, CS_DPAGE_BAR,
  type CsDisplayCfg, type CsDisplayPage, type CsNounCaps,
} from '@/domain';
import {
  cfgDraftFromLive, buildCfg, pageDraftFromLive, buildPage, pagesEqual, type CfgDraft, type PageDraft,
} from './csDisplayDraft';

// Minimal noun table for the page-draft tests -- indices here are local to
// this fixture, not real wire noun numbers.
const userVolumeNoun: CsNounCaps = {          // 0: continuous, untargeted
  kind: CsKind.Continuous, enumCount: 0, actions: 0x0C2F, minQ8: -15360, maxQ8: 0,
  unit: CS_UNIT_DB, targetKind: CS_TARGET_NONE, targetCount: 0, dflags: 0,
};
const presetNoun: CsNounCaps = {              // 1: enum, untargeted
  kind: CsKind.Enum, enumCount: 10, actions: 0x012E, minQ8: 0, maxQ8: 0,
  unit: CS_UNIT_NONE, targetKind: CS_TARGET_NONE, targetCount: 0, dflags: 0,
};
const preampNoun: CsNounCaps = {              // 2: continuous, input-channel targeted
  kind: CsKind.Continuous, enumCount: 0, actions: 0x0C2F, minQ8: -6144, maxQ8: 6144,
  unit: CS_UNIT_DB, targetKind: CS_TARGET_INPUT_CH, targetCount: 2, dflags: 0,
};
const nouns: CsNounCaps[] = [userVolumeNoun, presetNoun, preampNoun];

describe('cfg draft round-trip', () => {
  it('round-trips through seconds/tenths with both alignments and both bool flags', () => {
    const c: CsDisplayCfg = {
      mode: CsDisplayMode.CycleSelected, homePage: 3, dwell: 45, overlayHold: 12,
      brightness: 128,
      flags: CS_DCFG_OVERLAY_ANY | CS_DCFG_EDIT_GATED
        | (CsDisplayAlign.Centre << CS_DCFG_LABEL_ALIGN_SHIFT)
        | (CsDisplayAlign.Right << CS_DCFG_VALUE_ALIGN_SHIFT),
      editTimeout: 100,
    };
    const d = cfgDraftFromLive(c);
    expect(d).toEqual({
      mode: CsDisplayMode.CycleSelected, homePage: 3, dwell: 4.5, overlayHold: 1.2,
      brightness: 128, overlayAny: true, editGated: true,
      labelAlign: CsDisplayAlign.Centre, valueAlign: CsDisplayAlign.Right, editTimeout: 10,
    });
    expect(buildCfg(d)).toEqual(c);
  });

  it('clamps a 7000 s dwell to 0xFFFF', () => {
    const d: CfgDraft = {
      mode: CsDisplayMode.CycleAll, homePage: 0, dwell: 7000, overlayHold: 0,
      brightness: 0, overlayAny: false, editGated: false,
      labelAlign: CsDisplayAlign.Left, valueAlign: CsDisplayAlign.Left, editTimeout: 0,
    };
    expect(buildCfg(d).dwell).toBe(0xFFFF);
  });
});

describe('page draft', () => {
  it('round-trips a grouped continuous page with BAR', () => {
    const p: CsDisplayPage = { noun: 2, target: 3, index: 0, flags: CS_DPAGE_ACTIVE | CS_DPAGE_GROUP | CS_DPAGE_BAR };
    const d = pageDraftFromLive(p);
    expect(d).toEqual({ noun: 2, target: 3, index: 0, grouped: true, large: false, bar: true });
    expect(buildPage(d, nouns)).toEqual(p);
  });

  it('drops grouped and zeroes target on an untargeted noun', () => {
    const d: PageDraft = { noun: 0, target: 2, index: 0, grouped: true, large: false, bar: false };
    const built = buildPage(d, nouns);
    expect(built.flags & CS_DPAGE_GROUP).toBe(0);
    expect(built.target).toBe(0);
  });

  it('drops bar on an enum noun', () => {
    const d: PageDraft = { noun: 1, target: 0, index: 0, grouped: false, large: false, bar: true };
    expect(buildPage(d, nouns).flags & CS_DPAGE_BAR).toBe(0);
  });

  it('pagesEqual notices a LARGE-only change', () => {
    const a: CsDisplayPage = { noun: 0, target: 0, index: 0, flags: CS_DPAGE_ACTIVE };
    const b: CsDisplayPage = { noun: 0, target: 0, index: 0, flags: CS_DPAGE_ACTIVE | CS_DPAGE_LARGE };
    expect(pagesEqual(a, b)).toBe(false);
  });
});
