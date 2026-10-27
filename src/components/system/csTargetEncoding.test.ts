import { describe, it, expect } from 'vitest';
import { encodeTarget, decodeTarget, groupSplit } from './csTargetEncoding';

describe('target encoding', () => {
  it('round-trips channel and group picks, including index 0', () => {
    for (const pick of [
      { grouped: false, target: 0 }, { grouped: false, target: 7 },
      { grouped: true, target: 0 }, { grouped: true, target: 3 },
    ]) {
      expect(decodeTarget(encodeTarget(pick.grouped, pick.target))).toEqual(pick);
    }
  });
});

describe('groupSplit', () => {
  const groups = [{ v: 1 }, { v: 2 }];

  it('stays flat when groups are not offered, even for a grouped draft', () => {
    expect(groupSplit(false, groups, true, 9)).toEqual({ split: false, missing: false });
  });

  it('stays flat when there are no groups and the draft is not grouped', () => {
    expect(groupSplit(true, [], false, 0)).toEqual({ split: false, missing: false });
  });

  it('splits when groups exist', () => {
    expect(groupSplit(true, groups, false, 0)).toEqual({ split: true, missing: false });
  });

  it('keeps a vanished group visible as missing, even with no groups left', () => {
    expect(groupSplit(true, groups, true, 5)).toEqual({ split: true, missing: true });
    expect(groupSplit(true, [], true, 1)).toEqual({ split: true, missing: true });
  });

  it('does not flag a grouped draft whose group is still present', () => {
    expect(groupSplit(true, groups, true, 2).missing).toBe(false);
  });
});
