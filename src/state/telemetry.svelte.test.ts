import { describe, it, expect, beforeEach } from 'vitest';
import { status, resetStatus } from './telemetry.svelte';
import { makeReadySession, dispatch } from './appState.svelte';

function installSession(): void {
  dispatch({ t: 'synced', session: makeReadySession({ info: {}, hardware: {} } as never) });
}

describe('status (session-scoped forwarder)', () => {
  beforeEach(() => { dispatch({ t: 'disconnected' }); });

  it('reads inert defaults when there is no ready session', () => {
    expect(status.cpu0).toBe(0);
    expect(status.errorCount).toBe(0);
    expect(status.info).toBeNull();
  });

  it('writes route to the active session telemetry', () => {
    installSession();
    status.cpu0 = 42;
    status.errorCount = 3;
    expect(status.cpu0).toBe(42);
    expect(status.errorCount).toBe(3);
  });

  it('each session has independent telemetry', () => {
    installSession();
    status.cpu0 = 10;
    dispatch({ t: 'disconnected' });
    installSession();
    expect(status.cpu0).toBe(0);
  });

  it('resetStatus clears the active session telemetry', () => {
    installSession();
    status.cpu1 = 7;
    resetStatus();
    expect(status.cpu1).toBe(0);
  });
});
