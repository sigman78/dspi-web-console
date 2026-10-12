import { describe, it, expect, beforeEach } from 'vitest';
import { createEqLinkState } from './eqLink.svelte';
import { ChannelId, type EqLinkGroup } from '@/domain';

const STORAGE_KEY = 'dspi-console-web/eq-link/v1';
const OUT1: EqLinkGroup = [ChannelId.Out1L, ChannelId.Out1R];
const OUT2: EqLinkGroup = [ChannelId.Out2L, ChannelId.Out2R];

beforeEach(() => { localStorage.clear(); });

describe('createEqLinkState', () => {
  it('starts unlocked and reports only the channel itself', () => {
    const link = createEqLinkState('A', () => [OUT1]);
    expect(link.isLocked(ChannelId.Out1L)).toBe(false);
    expect(link.membersOf(ChannelId.Out1L)).toEqual([ChannelId.Out1L]);
    expect(link.peersOf(ChannelId.Out1L)).toEqual([]);
  });

  it('exposes members and peers once locked', () => {
    const link = createEqLinkState('A', () => [OUT1]);
    link.setLocked(ChannelId.Out1R, true);
    expect(link.isLocked(ChannelId.Out1L)).toBe(true);
    expect(link.membersOf(ChannelId.Out1R)).toEqual([ChannelId.Out1L, ChannelId.Out1R]);
    expect(link.peersOf(ChannelId.Out1R)).toEqual([ChannelId.Out1L]);
  });

  it('persists the lock per serial across recreation', () => {
    createEqLinkState('A', () => [OUT1, OUT2]).setLocked(ChannelId.Out2L, true);
    const again = createEqLinkState('A', () => [OUT1, OUT2]);
    expect(again.isLocked(ChannelId.Out2R)).toBe(true);
    expect(again.isLocked(ChannelId.Out1L)).toBe(false);
    expect(createEqLinkState('B', () => [OUT1, OUT2]).isLocked(ChannelId.Out2L)).toBe(false);
  });

  it('keeps other serials when writing', () => {
    createEqLinkState('A', () => [OUT1]).setLocked(ChannelId.Out1L, true);
    createEqLinkState('B', () => [OUT1]).setLocked(ChannelId.Out1L, true);
    expect(createEqLinkState('A', () => [OUT1]).isLocked(ChannelId.Out1L)).toBe(true);
  });

  it('persists unlocking', () => {
    const link = createEqLinkState('A', () => [OUT1]);
    link.setLocked(ChannelId.Out1L, true);
    link.setLocked(ChannelId.Out1L, false);
    expect(createEqLinkState('A', () => [OUT1]).isLocked(ChannelId.Out1L)).toBe(false);
  });

  it('does not report a vanished group as locked but keeps its key', () => {
    let groups = $state.raw<EqLinkGroup[]>([OUT1]);
    const link = createEqLinkState('A', () => groups);
    link.setLocked(ChannelId.Out1L, true);
    groups = [];
    expect(link.isLocked(ChannelId.Out1L)).toBe(false);
    groups = [OUT1];
    expect(link.isLocked(ChannelId.Out1L)).toBe(true);
  });

  it('ignores setLocked on a channel with no group', () => {
    const link = createEqLinkState('A', () => [OUT1]);
    link.setLocked(ChannelId.Pdm, true);
    expect(createEqLinkState('A', () => [OUT1]).isLocked(ChannelId.Out1L)).toBe(false);
    expect(link.isLocked(ChannelId.Pdm)).toBe(false);
  });

  it('tolerates garbage in storage', () => {
    for (const raw of ['not json', '[1,2]', '{"A":"x"}', '{"A":[1,"2+3"]}']) {
      localStorage.setItem(STORAGE_KEY, raw);
      expect(() => createEqLinkState('A', () => [OUT1])).not.toThrow();
    }
  });
});
