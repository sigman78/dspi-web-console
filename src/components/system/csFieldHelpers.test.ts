import { describe, it, expect } from 'vitest';
import {
  CsKind,
  CS_UNIT_NONE, CS_UNIT_HZ,
  CS_TARGET_NONE, CS_TARGET_INPUT_CH, CS_TARGET_OUTPUT_CH, CS_TARGET_DSP_CH, CS_TARGET_DSP_BAND,
  type CsNounCaps, type CsGroup, type ChannelModel,
} from '@/domain';
import { groupOptionsFor, groupBandOptionsFor } from './csFieldHelpers';

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
