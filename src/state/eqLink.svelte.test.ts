import { describe, it, expect, beforeEach } from 'vitest';
import { createEqLinkState } from './eqLink.svelte';
import { ChannelId, type EqLinkGroup } from '@/domain';

const STORAGE_KEY = 'dspi-console-web/eq-link/v1';
const OUT1: EqLinkGroup = [ChannelId.Out1L, ChannelId.Out1R];
const OUT2: EqLinkGroup = [ChannelId.Out2L, ChannelId.Out2R];

beforeEach(() => { localStorage.clear(); });

describe('createEqLinkState', () => {
  it('persists the lock per serial across recreation', () => {
    createEqLinkState('A', () => [OUT1, OUT2]).setLocked(ChannelId.Out2L, true);
    const again = createEqLinkState('A', () => [OUT1, OUT2]);
    expect(again.isLocked(ChannelId.Out2R)).toBe(true);
    expect(again.isLocked(ChannelId.Out1L)).toBe(false);
    expect(createEqLinkState('B', () => [OUT1, OUT2]).isLocked(ChannelId.Out2L)).toBe(false);
    createEqLinkState('B', () => [OUT1, OUT2]).setLocked(ChannelId.Out1L, true);
    expect(createEqLinkState('A', () => [OUT1, OUT2]).isLocked(ChannelId.Out2L)).toBe(true);
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

  it('tolerates garbage in storage', () => {
    for (const raw of ['not json', '[1,2]', '{"A":"x"}', '{"A":[1,"2+3"]}']) {
      localStorage.setItem(STORAGE_KEY, raw);
      expect(() => createEqLinkState('A', () => [OUT1])).not.toThrow();
    }
  });
});
