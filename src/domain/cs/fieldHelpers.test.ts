import { describe, it, expect } from 'vitest';
import * as Domain from '@/domain';
import type { CsNounCaps, CsGroup, CsMacro, CsCaps, CsDisplayPage, ChannelModel } from '@/domain';
import * as CsField from './fieldHelpers';
import { disabledNoun } from '@test/fixtures/csCaps';

function channel(over: Partial<ChannelModel>): ChannelModel {
  return {
    id: 0, name: 'Ch', defaultName: 'Ch', shortName: 'Ch',
    bandCount: 5, isOutput: false, filters: [], xoverBands: [],
    ...over,
  };
}

const inputChannelNoun: CsNounCaps = {
  kind: Domain.CsKind.Continuous, enumCount: 0, actions: 0, minQ8: 0, maxQ8: 0,
  unit: Domain.CS_UNIT_NONE, targetKind: Domain.CS_TARGET_INPUT_CH, targetCount: 2, dflags: 0,
};
const dspBandNoun: CsNounCaps = {
  kind: Domain.CsKind.Continuous, enumCount: 0, actions: 0, minQ8: 20, maxQ8: 20000,
  unit: Domain.CS_UNIT_HZ, targetKind: Domain.CS_TARGET_DSP_BAND, targetCount: 4, dflags: 0,
};
const nouns: CsNounCaps[] = [inputChannelNoun, dspBandNoun];

describe('groupOptionsFor', () => {
  it("lists only non-empty groups whose kind matches the noun's target space", () => {
    const groups: (CsGroup | null)[] = [
      { targetKind: Domain.CS_TARGET_INPUT_CH, memberMask: 0b11, name: 'Fronts' },  // matches inputChannelNoun
      { targetKind: Domain.CS_TARGET_OUTPUT_CH, memberMask: 0b1, name: 'Rear' },    // wrong kind for both nouns
      null,                                                                   // empty slot
      { targetKind: Domain.CS_TARGET_DSP_CH, memberMask: 0b1000, name: 'Woofer' },   // DSP_BAND noun -> DSP_CH kind
    ];
    expect(CsField.groupOptionsFor(nouns, 0, groups)).toEqual([{ v: 0, label: 'Group 1 · Fronts' }]);
    expect(CsField.groupOptionsFor(nouns, 1, groups)).toEqual([{ v: 3, label: 'Group 4 · Woofer' }]);
  });
});

describe('enumValueOptions on the Macro noun', () => {
  it('labels each slot with its name, or leaves it unnamed', () => {
    const macroNoun: CsNounCaps = {
      kind: Domain.CsKind.Enum, enumCount: 8, actions: 0, minQ8: 0, maxQ8: 0,
      unit: Domain.CS_UNIT_NONE, targetKind: Domain.CS_TARGET_NONE, targetCount: 0, dflags: 0,
    };
    const macroNouns: CsNounCaps[] = [...Array(Domain.CsNoun.Macro).fill(disabledNoun), macroNoun];
    const macros: (CsMacro | null)[] = [
      { ...Domain.EMPTY_CS_MACRO, name: 'Night', stepCount: 1 },
      null,
    ];
    const options = CsField.enumValueOptions(macroNouns, Domain.CsNoun.Macro, [], macros);
    expect(options).toHaveLength(8);
    expect(options[0]).toEqual({ v: 0, label: 'Macro 1 · Night' });
    expect(options[1]).toEqual({ v: 1, label: 'Macro 2' });
  });
});

describe('enumValueOptions on the DisplayPage noun', () => {
  it('labels each page with its bound item, or leaves it unlabeled', () => {
    const displayPageNoun: CsNounCaps = {
      kind: Domain.CsKind.Enum, enumCount: 16, actions: 0, minQ8: 0, maxQ8: 0,
      unit: Domain.CS_UNIT_NONE, targetKind: Domain.CS_TARGET_NONE, targetCount: 0, dflags: 0,
    };
    const pageNouns: CsNounCaps[] = [...Array(Domain.CsNoun.DisplayPage).fill(disabledNoun), displayPageNoun];
    const displayPages: (CsDisplayPage | null)[] = Array.from({ length: 16 }, () => null);
    displayPages[0] = { noun: Domain.CsNoun.UserVolume, target: 0, index: 0, flags: 1 };
    const options = CsField.enumValueOptions(pageNouns, Domain.CsNoun.DisplayPage, [], [], displayPages);
    expect(options).toHaveLength(16);
    expect(options[0]).toEqual({ v: 0, label: 'Page 1 · Volume' });
    expect(options[4]).toEqual({ v: 4, label: 'Page 5' });
  });
});

describe('pageNounOptions', () => {
  it('excludes a platform-unavailable noun and the three display-only nouns', () => {
    const usable: CsNounCaps = {
      kind: Domain.CsKind.Continuous, enumCount: 0, actions: 1, minQ8: 0, maxQ8: 100,
      unit: Domain.CS_UNIT_NONE, targetKind: Domain.CS_TARGET_NONE, targetCount: 0, dflags: 0,
    };
    const unavailable: CsNounCaps = { ...usable, actions: 0 };
    const displayNoun: CsNounCaps = { ...usable, kind: Domain.CsKind.Enum, enumCount: 16 };
    const nouns: CsNounCaps[] = [];
    nouns[Domain.CsNoun.UserVolume] = usable;
    nouns[Domain.CsNoun.Clip] = unavailable;
    nouns[Domain.CsNoun.DisplayPage] = displayNoun;
    nouns[Domain.CsNoun.DisplayEdit] = displayNoun;
    nouns[Domain.CsNoun.PageValue] = displayNoun;
    expect(CsField.pageNounOptions(nouns).map((o) => o.v)).toEqual([Domain.CsNoun.UserVolume]);
  });
});

describe('displaysAvailable', () => {
  const typeRow = { actions: 0, pinCount: 0, pinClass: 0 };
  function caps(capsVersion: number, typeCount: number): CsCaps {
    return {
      capsVersion, maxBindings: 16, maxIrCommands: 0, maxGroups: 0, maxMacros: 0, maxMacroSteps: 0,
      types: Array.from({ length: typeCount }, () => typeRow),
    };
  }

  it('requires both the caps version floor and a DISPLAY row in the type table', () => {
    expect(CsField.displaysAvailable(caps(9, 9))).toBe(false);
    expect(CsField.displaysAvailable(caps(10, 8))).toBe(false);
    expect(CsField.displaysAvailable(caps(10, 9))).toBe(true);
  });
});

describe('groupBandOptionsFor', () => {
  it('intersects band options across members with different band counts', () => {
    const channels = [channel({ id: 0, bandCount: 2 }), channel({ id: 1, bandCount: 5 })];
    const group: CsGroup = { targetKind: Domain.CS_TARGET_DSP_CH, memberMask: 0b11, name: 'Pair' };
    expect(CsField.groupBandOptionsFor(nouns, 1, group, channels)).toEqual([
      { v: 0, label: 'Band 1' },
      { v: 1, label: 'Band 2' },
    ]);
  });

  it("ignores members outside the noun's addressing range", () => {
    // dspBandNoun addresses 4 channels; the member at bit 5 exists on no
    // channel list and must not empty the intersection.
    const channels = [channel({ id: 0, bandCount: 3 }), channel({ id: 1, bandCount: 3 })];
    const group: CsGroup = { targetKind: Domain.CS_TARGET_DSP_CH, memberMask: 0b100001, name: 'Odd' };
    expect(CsField.groupBandOptionsFor(nouns, 1, group, channels)).toHaveLength(3);
  });

  it('returns no bands for an empty group', () => {
    const channels = [channel({ id: 0, bandCount: 3 })];
    const group: CsGroup = { targetKind: Domain.CS_TARGET_NONE, memberMask: 0, name: '' };
    expect(CsField.groupBandOptionsFor(nouns, 1, group, channels)).toEqual([]);
  });
});
