import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { applyParamChange } from './notifyApply';
import { write } from './writes.svelte';
import { resetWireMirror } from './wireMirror';
import { dispatch, makeReadySession, type ReadySession } from '@/state';
import { MockTransport } from '@/transport/MockTransport';
import { DspDevice } from '@/device/DspDevice';
import type { ParamChangedEvent } from '@/protocol';

const BYPASS_OFFSET = 20;

function ev(offset: number, value: number[]): ParamChangedEvent {
  return { kind: 'paramChanged', seq: 1, source: 5, offset, size: value.length, value: new Uint8Array(value) };
}

// Install a ready session and hydrate its MirrorState, which applyParamChange
// reads via the session.
async function setup(): Promise<{ session: ReadySession; mir: ReadySession['mirror'] }> {
  const mock = new MockTransport({ platform: 'rp2350', wireVersion: 10, fwVersion: { major: 1, minor: 1, patch: 4 } });
  const dev = await DspDevice.create(mock);
  const session = makeReadySession(dev);
  dispatch({ t: 'synced', session });
  session.mirror.init(await dev.getSnapshot());   // current populated; dev.lastRawBulk populated
  return { session, mir: session.mirror };
}

beforeEach(() => { resetWireMirror(); });
afterEach(() => { dispatch({ t: 'disconnected' }); });

describe('applyParamChange', () => {
  it('applies a notified field into mirror.current and returns true', async () => {
    const { session, mir } = await setup();
    expect(mir.current?.bypass).toBe(false);
    expect(applyParamChange(session, ev(BYPASS_OFFSET, [1]))).toBe(true);
    expect(mir.current?.bypass).toBe(true);
  });

  it('returns false and does not mutate while a write is registered-unsettled', async () => {
    const { session, mir } = await setup();
    session.writes.claim();
    try {
      expect(applyParamChange(session, ev(BYPASS_OFFSET, [1]))).toBe(false);
      expect(mir.current?.bypass).toBe(false);
    } finally {
      session.writes.release();
    }
  });

  it('returns false while an actual write() is in flight on the session (busy via the real lane)', async () => {
    const { session, mir } = await setup();
    let resolveSend!: () => void;
    const pending = write(session, () => new Promise<void>((r) => { resolveSend = r; }), () => {});
    expect(applyParamChange(session, ev(BYPASS_OFFSET, [1]))).toBe(false);
    resolveSend();
    await pending;
    expect(mir.current?.bypass).toBe(false);
  });

  it('returns false for an out-of-range offset', async () => {
    const { session } = await setup();
    expect(applyParamChange(session, ev(999999, [1]))).toBe(false);
  });

  it('returns false when there is no mirror.current', async () => {
    const { session, mir } = await setup();
    mir.reset();   // clears current
    expect(applyParamChange(session, ev(BYPASS_OFFSET, [1]))).toBe(false);
  });

  it('does not revert an unrelated in-flight user edit (drift-safe)', async () => {
    const { session, mir } = await setup();
    // A user edit drifts current from the raw wire buffer (granular writes
    // never touch lastRawBulk). Done directly here, so writes.busy stays false.
    mir.current!.crossfeed.freq = 1234;
    // A PARAM_CHANGED for an UNRELATED field (bypass).
    expect(applyParamChange(session, ev(BYPASS_OFFSET, [1]))).toBe(true);
    expect(mir.current!.bypass).toBe(true);          // notified field applied
    expect(mir.current!.crossfeed.freq).toBe(1234);  // user's unrelated edit preserved
  });
});
