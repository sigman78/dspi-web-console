import { describe, it, expect, beforeEach } from 'vitest';
import type { PresetSlot } from '@/domain';
import { copySource, setCopySource, clearCopySource } from './copySource.svelte';
import { makeReadySession, dispatch } from './appState.svelte';

const SLOT = 2 as PresetSlot;

function installSession(): void {
  dispatch({ t: 'synced', session: makeReadySession({ info: {}, hardware: {} } as never) });
}

describe('copySource (session-scoped forwarder)', () => {
  beforeEach(() => { dispatch({ t: 'disconnected' }); });

  it('reads null when there is no ready session', () => {
    expect(copySource.slot).toBeNull();
  });

  it('set/clear operate on the active session', () => {
    installSession();
    setCopySource(SLOT);
    expect(copySource.slot).toBe(SLOT);
    clearCopySource();
    expect(copySource.slot).toBeNull();
  });

  it('set is a no-op when there is no session', () => {
    setCopySource(SLOT);
    expect(copySource.slot).toBeNull();
  });

  it('disconnect drops the copy source with its session', () => {
    installSession();
    setCopySource(SLOT);
    dispatch({ t: 'disconnected' });
    expect(copySource.slot).toBeNull();
  });
});
