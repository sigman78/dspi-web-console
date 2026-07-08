import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { bootMock } from './boot';
import { endConnection } from './connectionScope';
import { activeSession, dispatch } from '@/state';

// Locks the connect ordering that kills the "all channels possible -> actual
// configuration" flash: the mirror is initialised and the live input-channel
// count is seeded from an initial status read BEFORE `synced` is dispatched, so
// channel-dependent views (rail, mixer, overview) paint the real width on their
// first frame. The poll's status cadence is on a timer that never fires within a
// test, so any non-null count here must have come from the pre-`synced` seed.

beforeEach(() => { dispatch({ t: 'disconnected' }); });
afterEach(() => { endConnection(); dispatch({ t: 'disconnected' }); });

describe('wireUpConnection — channel-width seed', () => {
  it('V16: seeds the live input count and mirror before the UI first renders', async () => {
    await bootMock('rp2350', { wireVersion: 16, fwVersion: { major: 1, minor: 1, patch: 5 } });
    const s = activeSession()!;
    // Would be null under the old dispatch-then-init order (no poll has run).
    expect(s.telemetry.activeInputChannels).toBe(2);
    expect(s.mirror.current).not.toBeNull();
  });

  it('V10: reports no live count, staying null (= show all, its true fixed width)', async () => {
    await bootMock('rp2040');
    const s = activeSession()!;
    expect(s.telemetry.activeInputChannels).toBeNull();
    expect(s.mirror.current).not.toBeNull();
  });
});
