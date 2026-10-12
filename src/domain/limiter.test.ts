import { describe, it, expect } from 'vitest';
import { settleLimiterGroups, joinLimiterGroup, type LimiterOutput } from './processing';

const lim = (linkGroup: number, thresholdDb = -1, enabled = false, releaseMs = 100): LimiterOutput =>
  ({ enabled, linkGroup, thresholdDb, releaseMs });

describe('settleLimiterGroups', () => {
  it('copies the lowest member over every member of each group, independently per group', () => {
    const list = [lim(1, -3, true, 50), lim(2, -9), lim(1, -20), lim(0, -7), lim(2, -15, true, 400)];
    const out = settleLimiterGroups(list, 5);
    expect(out[2]).toEqual(lim(1, -3, true, 50));
    expect(out[4]).toEqual(lim(2, -9));
    expect(out[0]).toEqual(list[0]);
    expect(out[1]).toEqual(list[1]);
    expect(out[3]).toEqual(list[3]);
  });

  it('leaves a lone member and unlinked outputs untouched', () => {
    const list = [lim(3, -4, true), lim(0, -8), lim(0, -2, true)];
    expect(settleLimiterGroups(list, 3)).toEqual(list);
  });

  it('never touches entries at or past numOut and does not mutate the input', () => {
    const list = [lim(1, -3, true), lim(1, -20), lim(1, -25)];
    const out = settleLimiterGroups(list, 2);
    expect(out[1].thresholdDb).toBe(-3);
    expect(out[2]).toEqual(lim(1, -25));
    expect(list[1].thresholdDb).toBe(-20);
  });
});

describe('joinLimiterGroup', () => {
  it('a joiner adopts the lowest OTHER member, even when it is itself the lowest index; members never change', () => {
    const list = [lim(0, -20, false, 10), lim(1, -5, true, 300), lim(0, -7), lim(1, -5, true, 300)];
    const out = joinLimiterGroup(list, 0, 1, 4);
    expect(out[0]).toEqual(lim(1, -5, true, 300));
    expect(out[1]).toEqual(list[1]);
    expect(out[3]).toEqual(list[3]);
    expect(list[0].linkGroup).toBe(0);
  });

  it('the only member of a group keeps its own settings; so does an output leaving to group 0', () => {
    const list = [lim(1, -5, true, 300), lim(0, -9), lim(1, -5, true, 300)];
    expect(joinLimiterGroup(list, 1, 3, 3)[1]).toEqual(lim(3, -9));
    const left = joinLimiterGroup(list, 2, 0, 3);
    expect(left[2]).toEqual(lim(0, -5, true, 300));
    expect(left[0]).toEqual(list[0]);
  });

  it('ignores members at or past numOut', () => {
    const list = [lim(0, -9), lim(0, -1), lim(1, -5, true)];
    expect(joinLimiterGroup(list, 0, 1, 2)[0]).toEqual(lim(1, -9));
  });
});
