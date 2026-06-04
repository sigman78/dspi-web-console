import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { applyParamChange } from './notifyApply';
import { resetWireMirror } from './wireMirror';
import { mirror } from '@/state/mirror.svelte';
import { dispatch, makeReadySession, type ReadySession } from '@/state';
import { MockTransport } from '@/transport/MockTransport';
import { DspDevice } from '@/device/DspDevice';
import type { ParamChangedEvent } from '@/protocol';

const BYPASS_OFFSET = 20;

function ev(offset: number, value: number[]): ParamChangedEvent {
  return { kind: 'paramChanged', seq: 1, source: 5, offset, size: value.length, value: new Uint8Array(value) };
}

// Install a ready session so `mirror.init`/`mirror.current` resolve to its
// MirrorState, which is the same instance threaded into applyParamChange as `mir`.
async function setup(): Promise<{ dev: DspDevice; session: ReadySession; mir: ReadySession['mirror'] }> {
  const mock = new MockTransport({ platform: 'rp2350', wireVersion: 10, fwVersion: { major: 1, minor: 1, patch: 4 } });
  const dev = await DspDevice.create(mock);
  const session = makeReadySession(dev);
  dispatch({ t: 'synced', session });
  mirror.init(await dev.getSnapshot());   // mirror.current populated; dev.lastRawBulk populated
  return { dev, session, mir: session.mirror };
}

beforeEach(() => { resetWireMirror(); });
afterEach(() => { dispatch({ t: 'disconnected' }); });

describe('applyParamChange', () => {
  it('applies a notified field into mirror.current and returns true', async () => {
    const { dev, mir } = await setup();
    expect(mirror.current?.bypass).toBe(false);
    expect(applyParamChange(dev, mir, ev(BYPASS_OFFSET, [1]))).toBe(true);
    expect(mirror.current?.bypass).toBe(true);
  });

  it('returns false and does not mutate while a write is in flight', async () => {
    const { dev, mir } = await setup();
    mir.bumpInflight();
    try {
      expect(applyParamChange(dev, mir, ev(BYPASS_OFFSET, [1]))).toBe(false);
      expect(mirror.current?.bypass).toBe(false);
    } finally {
      mir.dropInflight();
    }
  });

  it('returns false for an out-of-range offset', async () => {
    const { dev, mir } = await setup();
    expect(applyParamChange(dev, mir, ev(999999, [1]))).toBe(false);
  });

  it('returns false when there is no mirror.current', async () => {
    const { dev, mir } = await setup();
    mir.reset();   // clears current
    expect(applyParamChange(dev, mir, ev(BYPASS_OFFSET, [1]))).toBe(false);
  });

  it('returns false within the post-write quiet window (mid-drag gap, inflight=0)', async () => {
    const { dev, mir } = await setup();
    mir.noteWriteActivity();   // a coalesced scrub send just landed; inflight is 0 in the gap
    expect(applyParamChange(dev, mir, ev(BYPASS_OFFSET, [1]))).toBe(false);
    expect(mirror.current?.bypass).toBe(false);
  });

  it('does not revert an unrelated in-flight user edit (drift-safe)', async () => {
    const { dev, mir } = await setup();
    // A user edit drifts mirror.current from the raw wire buffer (granular writes
    // never touch lastRawBulk). Done directly here, so it does not stamp write
    // activity — the quiet-window guard stays open.
    mirror.current!.crossfeed.freq = 1234;
    // A PARAM_CHANGED for an UNRELATED field (bypass).
    expect(applyParamChange(dev, mir, ev(BYPASS_OFFSET, [1]))).toBe(true);
    expect(mirror.current!.bypass).toBe(true);          // notified field applied
    expect(mirror.current!.crossfeed.freq).toBe(1234);  // user's unrelated edit preserved
  });
});
