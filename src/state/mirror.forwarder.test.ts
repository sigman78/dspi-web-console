import { describe, it, expect, beforeEach } from 'vitest';
import { mirror, presetBaseline, inflight, bumpInflight } from './mirror.svelte';
import { dispatch } from './appState.svelte';
import { makeReadySession } from './makeSession.svelte';

const SNAP = { masterVolumeDb: -10 } as never;

function installSession(): void {
  dispatch({ t: 'synced', session: makeReadySession({ info: {}, hardware: {} } as never) });
}

describe('mirror (session-scoped forwarder)', () => {
  beforeEach(() => { dispatch({ t: 'disconnected' }); });

  it('reads null current / zero inflight with no session', () => {
    expect(mirror.current).toBeNull();
    expect(inflight.current).toBe(0);
  });

  it('init routes to the active session and sets baseline', () => {
    installSession();
    mirror.init(SNAP);
    expect(mirror.current).toStrictEqual(SNAP);
    expect(presetBaseline.current).not.toBeNull();
  });

  it('inflight and current are independent per session', () => {
    installSession();
    mirror.init(SNAP);
    bumpInflight();
    expect(inflight.current).toBe(1);
    dispatch({ t: 'disconnected' });
    installSession();
    expect(mirror.current).toBeNull();
    expect(inflight.current).toBe(0);
  });

  it('returns the live snapshot object (in-place mutation is visible)', () => {
    installSession();
    mirror.init({ masterVolumeDb: -10 } as never);
    (mirror.current as { masterVolumeDb: number }).masterVolumeDb = -20;
    expect((mirror.current as { masterVolumeDb: number }).masterVolumeDb).toBe(-20);
  });
});
