import { describe, it, expect } from 'vitest';
import * as Domain from '@/domain';
import type { CsDisplayCfg, CsDisplayPage, CsNounCaps } from '@/domain';
import * as CsDisplayDraft from './displayDraft';
import type { CfgDraft, PageDraft } from './displayDraft';
import { csNouns } from '@test/fixtures/csCaps';

// Minimal noun table for the page-draft tests -- indices here are local to
// this fixture, not real wire noun numbers.
const nouns: CsNounCaps[] = [
  csNouns[Domain.CsNoun.UserVolume],  // 0: continuous, untargeted
  csNouns[Domain.CsNoun.Preset],      // 1: enum, untargeted
  csNouns[Domain.CsNoun.Preamp],      // 2: continuous, input-channel targeted
];

describe('cfg draft round-trip', () => {
  it('round-trips through seconds/tenths with both alignments and both bool flags', () => {
    const c: CsDisplayCfg = {
      mode: Domain.CsDisplayMode.CycleSelected, homePage: 3, dwell: 45, overlayHold: 12,
      brightness: 128,
      flags: Domain.CS_DCFG_OVERLAY_ANY | Domain.CS_DCFG_EDIT_GATED
        | (Domain.CsDisplayAlign.Centre << Domain.CS_DCFG_LABEL_ALIGN_SHIFT)
        | (Domain.CsDisplayAlign.Right << Domain.CS_DCFG_VALUE_ALIGN_SHIFT),
      editTimeout: 100,
    };
    const d = CsDisplayDraft.cfgDraftFromLive(c);
    expect(d).toEqual({
      mode: Domain.CsDisplayMode.CycleSelected, homePage: 3, dwell: 4.5, overlayHold: 1.2,
      brightness: 128, overlayAny: true, editGated: true,
      labelAlign: Domain.CsDisplayAlign.Centre, valueAlign: Domain.CsDisplayAlign.Right, editTimeout: 10,
    });
    expect(CsDisplayDraft.buildCfg(d)).toEqual(c);
  });

  it('clamps a 7000 s dwell to 0xFFFF', () => {
    const d: CfgDraft = {
      mode: Domain.CsDisplayMode.CycleAll, homePage: 0, dwell: 7000, overlayHold: 0,
      brightness: 0, overlayAny: false, editGated: false,
      labelAlign: Domain.CsDisplayAlign.Left, valueAlign: Domain.CsDisplayAlign.Left, editTimeout: 0,
    };
    expect(CsDisplayDraft.buildCfg(d).dwell).toBe(0xFFFF);
  });
});

describe('page draft', () => {
  it('round-trips a grouped continuous page with BAR', () => {
    const p: CsDisplayPage = { noun: 2, target: 3, index: 0, flags: Domain.CS_DPAGE_ACTIVE | Domain.CS_DPAGE_GROUP | Domain.CS_DPAGE_BAR };
    const d = CsDisplayDraft.pageDraftFromLive(p);
    expect(d).toEqual({ noun: 2, target: 3, index: 0, grouped: true, large: false, bar: true });
    expect(CsDisplayDraft.buildPage(d, nouns)).toEqual(p);
  });

  it('drops grouped and zeroes target on an untargeted noun', () => {
    const d: PageDraft = { noun: 0, target: 2, index: 0, grouped: true, large: false, bar: false };
    const built = CsDisplayDraft.buildPage(d, nouns);
    expect(built.flags & Domain.CS_DPAGE_GROUP).toBe(0);
    expect(built.target).toBe(0);
  });

  it('drops bar on an enum noun', () => {
    const d: PageDraft = { noun: 1, target: 0, index: 0, grouped: false, large: false, bar: true };
    expect(CsDisplayDraft.buildPage(d, nouns).flags & Domain.CS_DPAGE_BAR).toBe(0);
  });

  it('pagesEqual notices a LARGE-only change', () => {
    const a: CsDisplayPage = { noun: 0, target: 0, index: 0, flags: Domain.CS_DPAGE_ACTIVE };
    const b: CsDisplayPage = { noun: 0, target: 0, index: 0, flags: Domain.CS_DPAGE_ACTIVE | Domain.CS_DPAGE_LARGE };
    expect(CsDisplayDraft.pagesEqual(a, b)).toBe(false);
  });
});
