import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bootMock } from './boot';
import { startPolling } from './poll';
import * as Writes from './writes.svelte';
import * as VolumeActions from './volumeActions';
import * as State from '@/state';
import { MockTransport } from '@/transport/MockTransport';
import { resolveMockProfile } from '@/mockProfiles';
import type { LoopClock } from '@/utils';

function manualClock(): LoopClock & { fire(): void } {
  let cb: (() => void) | null = null;
  return {
    next(c) { cb = c; },
    cancel() { cb = null; },
    fire() { const c = cb; cb = null; c?.(); },
  };
}

async function bootPaged(): Promise<State.ReadySession> {
  const profile = resolveMockProfile('v34', 'rp2350');
  await bootMock(profile.platform, profile.opts);
  return State.activeSession()!;
}

beforeEach(() => { State.resetAppState(); State.clearNotices(); });
afterEach(() => { State.activeSession()?.dispose(); State.resetAppState(); vi.restoreAllMocks(); });

describe('writable paged session', () => {
  it('sends a write, a command and a scrub as paged OUT transfers and updates the mirror', async () => {
    const outs: number[] = [];
    const realOut = MockTransport.prototype.ctrlOut;
    vi.spyOn(MockTransport.prototype, 'ctrlOut').mockImplementation(function (this: MockTransport, cmd, value, data) {
      outs.push(cmd);
      return realOut.call(this, cmd, value, data);
    });
    const s = await bootPaged();
    const before = s.mirror.snapshot.bypass;

    expect(await Writes.write(s, () => s.device.setBypass(!before), () => { s.mirror.snapshot.bypass = !before; })).toBe(true);
    expect(s.mirror.snapshot.bypass).toBe(!before);

    const onSettled = vi.fn();
    await Writes.command(s, 'op', () => s.device.setMasterVolume(-12), onSettled);
    expect(onSettled).toHaveBeenCalled();

    VolumeActions.setMasterVolume(s, -20);
    await s.writes.flush();
    expect(s.mirror.snapshot.masterVolumeDb).toBe(-20);

    expect(outs.length).toBeGreaterThanOrEqual(3);
    expect(outs.every((c) => c > 0xFF)).toBe(true);
    expect(State.notices.list).toEqual([]);
  });

  it('updates the meters from the status cadence', async () => {
    const s = await bootPaged();
    const clock = manualClock();
    const stop = startPolling(s, clock);
    clock.fire();
    await vi.waitFor(() => expect(s.telemetry.lastStatusMs).toBeGreaterThan(0));
    stop();
    expect(s.telemetry.peaks.length).toBeGreaterThan(0);
  });

  it('keeps the system clock panel hidden', async () => {
    const s = await bootPaged();
    expect(s.sysClock.supported).toBe(false);
  });
});
