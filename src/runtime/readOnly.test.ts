import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bootMock } from './boot';
import { startPolling } from './poll';
import { startNotifyChannel } from './notifyChannel';
import * as Writes from './writes.svelte';
import * as Presets from './presets';
import * as DeviceService from './deviceService';
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

describe('read-only session', () => {
  it('connects without issuing a legacy request', async () => {
    const seen: number[] = [];
    const realIn = MockTransport.prototype.ctrlIn;
    vi.spyOn(MockTransport.prototype, 'ctrlIn').mockImplementation(function (this: MockTransport, cmd, value, length) {
      seen.push(cmd);
      return realIn.call(this, cmd, value, length);
    });
    const s = await bootPaged();
    expect(State.connection.phase).toBe('ready');
    expect(s.mirror.current).not.toBeNull();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter((c) => c <= 0xFF)).toEqual([]);
  });

  it('refuses write, command and scrub: nothing sent, nothing mutated', async () => {
    const s = await bootPaged();
    const send = vi.fn(async () => {});
    const mutate = vi.fn();
    expect(await Writes.write(s, send, mutate)).toBe(false);
    await Writes.command(s, 'op', send, mutate);
    Writes.scrub(s, 'k', mutate, send);
    await s.writes.flush();
    expect(send).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
    expect(State.notices.list).toEqual([]);
  });

  it('reports a read-only refusal from a preset op without touching the device', async () => {
    const s = await bootPaged();
    const spy = vi.spyOn(s.device, 'setPresetName');
    const r = await Presets.renamePresetSlot(s, 0, 'x');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toMatch(/read-only/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses a factory reset with a read-only notice', async () => {
    const s = await bootPaged();
    const spy = vi.spyOn(s.device, 'factoryReset');
    await DeviceService.factoryResetDevice();
    expect(spy).not.toHaveBeenCalled();
    const n = State.notices.list.at(-1);
    expect(n?.kind).toBe('warn');
    expect(n?.message).toMatch(/read-only/i);
  });

  it('sends no OUT transfer across connect, polling, notify reads and attempted writes', async () => {
    const outs: number[] = [];
    vi.spyOn(MockTransport.prototype, 'ctrlOut').mockImplementation(async (cmd) => { outs.push(cmd); });
    const s = await bootPaged();
    const clock = manualClock();
    const notifyClock = manualClock();
    const stopPoll = startPolling(s, clock);
    for (let i = 0; i < 3; i++) {
      s.mirror.requestReconcile(true);
      clock.fire();
      await vi.waitFor(() => expect(s.telemetry.lastParamMs).toBeGreaterThan(0));
      s.telemetry.lastParamMs = 0;
    }
    const stopNotify = startNotifyChannel(s, notifyClock);
    notifyClock.fire();
    await s.device.readNotification();
    await Writes.write(s, async () => { await s.device.setBypass(true); }, () => {});
    await Writes.command(s, 'op', () => s.device.setMasterVolume(-10), () => {});
    Writes.scrub(s, 'k', () => {}, () => s.device.setMasterVolume(-20));
    await Presets.renamePresetSlot(s, 0, 'x');
    await s.writes.flush();
    stopPoll();
    stopNotify();
    expect(outs).toEqual([]);
  });

  it('polls the snapshot reconcile and nothing else', async () => {
    const s = await bootPaged();
    const snapshot = vi.spyOn(s.device, 'getSnapshot');
    const status = vi.spyOn(s.device, 'getSystemStatus');
    const info = vi.spyOn(s.device, 'getSystemInfo');
    const clock = manualClock();
    s.mirror.requestReconcile(true);
    const stop = startPolling(s, clock);
    clock.fire();
    await vi.waitFor(() => expect(snapshot).toHaveBeenCalled());
    expect(status).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    stop();
  });
});
