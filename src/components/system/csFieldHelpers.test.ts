import { describe, it, expect } from 'vitest';
import {
  CsNoun, CsKind,
  CS_UNIT_NONE, CS_UNIT_HZ,
  CS_TARGET_NONE, CS_TARGET_INPUT_CH, CS_TARGET_OUTPUT_CH, CS_TARGET_DSP_CH, CS_TARGET_DSP_BAND,
  EMPTY_CS_MACRO,
  type CsNounCaps, type CsGroup, type CsMacro, type ChannelModel,
} from '@/domain';
import { groupOptionsFor, groupBandOptionsFor, enumValueOptions } from './csFieldHelpers';

function channel(over: Partial<ChannelModel>): ChannelModel {
  return {
    id: 0, name: 'Ch', defaultName: 'Ch', shortName: 'Ch',
    bandCount: 5, isOutput: false, filters: [], xoverBands: [],
    ...over,
  };
}

const inputChannelNoun: CsNounCaps = {
  kind: CsKind.Continuous, enumCount: 0, actions: 0, minQ8: 0, maxQ8: 0,
  unit: CS_UNIT_NONE, targetKind: CS_TARGET_INPUT_CH, targetCount: 2, dflags: 0,
};
const dspBandNoun: CsNounCaps = {
  kind: CsKind.Continuous, enumCount: 0, actions: 0, minQ8: 20, maxQ8: 20000,
  unit: CS_UNIT_HZ, targetKind: CS_TARGET_DSP_BAND, targetCount: 4, dflags: 0,
};
const nouns: CsNounCaps[] = [inputChannelNoun, dspBandNoun];

describe('groupOptionsFor', () => {
  it("lists only non-empty groups whose kind matches the noun's target space", () => {
    const groups: (CsGroup | null)[] = [
      { targetKind: CS_TARGET_INPUT_CH, memberMask: 0b11, name: 'Fronts' },  // matches inputChannelNoun
      { targetKind: CS_TARGET_OUTPUT_CH, memberMask: 0b1, name: 'Rear' },    // wrong kind for both nouns
      null,                                                                   // empty slot
      { targetKind: CS_TARGET_DSP_CH, memberMask: 0b1000, name: 'Woofer' },   // DSP_BAND noun -> DSP_CH kind
    ];
    expect(groupOptionsFor(nouns, 0, groups)).toEqual([{ v: 0, label: 'Group 1 · Fronts' }]);
    expect(groupOptionsFor(nouns, 1, groups)).toEqual([{ v: 3, label: 'Group 4 · Woofer' }]);
  });
});

describe('enumValueOptions on the Macro noun', () => {
  it('labels each slot with its name, or leaves it unnamed', () => {
    const disabledNoun: CsNounCaps = {
      kind: CsKind.Bool, enumCount: 0, actions: 0, minQ8: 0, maxQ8: 0,
      unit: CS_UNIT_NONE, targetKind: CS_TARGET_NONE, targetCount: 0, dflags: 0,
    };
    const macroNoun: CsNounCaps = {
      kind: CsKind.Enum, enumCount: 8, actions: 0, minQ8: 0, maxQ8: 0,
      unit: CS_UNIT_NONE, targetKind: CS_TARGET_NONE, targetCount: 0, dflags: 0,
    };
    const macroNouns: CsNounCaps[] = [...Array(CsNoun.Macro).fill(disabledNoun), macroNoun];
    const macros: (CsMacro | null)[] = [
      { ...EMPTY_CS_MACRO, name: 'Night', stepCount: 1 },
      null,
    ];
    const options = enumValueOptions(macroNouns, CsNoun.Macro, [], macros);
    expect(options).toHaveLength(8);
    expect(options[0]).toEqual({ v: 0, label: 'Macro 1 · Night' });
    expect(options[1]).toEqual({ v: 1, label: 'Macro 2' });
  });
});

describe('groupBandOptionsFor', () => {
  it('intersects band options across members with different band counts', () => {
    const channels = [channel({ id: 0, bandCount: 2 }), channel({ id: 1, bandCount: 5 })];
    const group: CsGroup = { targetKind: CS_TARGET_DSP_CH, memberMask: 0b11, name: 'Pair' };
    expect(groupBandOptionsFor(nouns, 1, group, channels)).toEqual([
      { v: 0, label: 'Band 1' },
      { v: 1, label: 'Band 2' },
    ]);
  });

  it("ignores members outside the noun's addressing range", () => {
    // dspBandNoun addresses 4 channels; the member at bit 5 exists on no
    // channel list and must not empty the intersection.
    const channels = [channel({ id: 0, bandCount: 3 }), channel({ id: 1, bandCount: 3 })];
    const group: CsGroup = { targetKind: CS_TARGET_DSP_CH, memberMask: 0b100001, name: 'Odd' };
    expect(groupBandOptionsFor(nouns, 1, group, channels)).toHaveLength(3);
  });

  it('returns no bands for an empty group', () => {
    const channels = [channel({ id: 0, bandCount: 3 })];
    const group: CsGroup = { targetKind: CS_TARGET_NONE, memberMask: 0, name: '' };
    expect(groupBandOptionsFor(nouns, 1, group, channels)).toEqual([]);
  });
});
