import { describe, it, expect, beforeEach, vi } from 'vitest';
import { session } from '@/state';
import { mirror } from '@/state/mirror.svelte';
import type { DspDevice } from '@/device/DspDevice';
import type { DspSnapshot, ChannelId } from '@/domain';
import { Result } from '@/utils';
import { device, snapshot, i2s, channel, send, run, capture, NotReady, DeviceRejected } from './actionContext';

// Minimal snapshot carrying only the fields the resolvers read. Cast because a
// faithful full snapshot is irrelevant to precondition resolution.
function fakeSnapshot(over: Partial<DspSnapshot> = {}): DspSnapshot {
  return {
    channels: [{ id: 5 as ChannelId, filters: [] }],
    i2s: { outputSlotTypes: [0, 0, 0, 0], bckPin: 2, mckPin: 3, mckEnabled: false, mckMultiplierEncoded: 0 },
    ...over,
  } as unknown as DspSnapshot;
}

const fakeDevice = {} as unknown as DspDevice;

beforeEach(() => {
  session.device = null;
  mirror.reset();
});

describe('resolvers', () => {
  it('device() returns the bound device, else throws NotReady', () => {
    expect(() => device()).toThrow(NotReady);
    session.device = fakeDevice;
    expect(device()).toBe(session.device); // identity via the $state proxy, not the raw object
  });

  it('snapshot() returns the current mirror, else throws NotReady', () => {
    expect(() => snapshot()).toThrow(NotReady);
    mirror.init(fakeSnapshot());
    expect(snapshot()).toBe(mirror.current);
  });

  it('i2s() returns the section when present', () => {
    mirror.init(fakeSnapshot());
    expect(i2s().bckPin).toBe(2);
  });

  it('i2s() throws NotReady when there is no snapshot (presence == hydration)', () => {
    expect(() => i2s()).toThrow(NotReady);
  });

  it('channel() returns the matching channel, else throws NotReady', () => {
    mirror.init(fakeSnapshot());
    expect(channel(5 as ChannelId).id).toBe(5);
    expect(() => channel(9 as ChannelId)).toThrow(NotReady);
  });
});

describe('send', () => {
  it('resolves when the device Result is ok', async () => {
    await expect(send('op', async () => Result.ok())).resolves.toBeUndefined();
  });

  it('throws DeviceRejected carrying op, message, and code when the Result fails', async () => {
    let thrown: unknown;
    await send('switch output type', async () => Result.fail(0x02, 'pin in use')).catch((e) => { thrown = e; });
    expect(thrown).toBeInstanceOf(DeviceRejected);
    const e = thrown as DeviceRejected;
    expect(e.op).toBe('switch output type');
    expect(e.message).toContain('pin in use');
    expect(e.code).toBe(0x02);
  });
});

describe('run boundary', () => {
  it('swallows a NotReady precondition without rejecting and without disrupting status', async () => {
    session.status = 'connected';
    const body = vi.fn(() => { device(); }); // no device bound -> throws NotReady
    await expect(run('setX', body)).resolves.toBeUndefined();
    expect(body).toHaveBeenCalledOnce();
    expect(session.status).toBe('connected'); // a missing prerequisite must not error the connection
  });

  it('swallows a DeviceRejected from an async body without rejecting', async () => {
    await expect(
      run('setX', () => send('op', async () => Result.fail('x', 'nope'))),
    ).resolves.toBeUndefined();
  });

  it('swallows an unexpected throw without rejecting', async () => {
    await expect(run('setX', () => { throw new Error('boom'); })).resolves.toBeUndefined();
  });

  it('runs the happy path to completion and resolves', async () => {
    session.device = fakeDevice;
    mirror.init(fakeSnapshot());
    const sent: string[] = [];
    await run('setBck', () => {
      device();
      i2s();
      return send('set bck', async () => { sent.push('bck'); return Result.ok(); });
    });
    expect(sent).toEqual(['bck']);
  });

  it('short-circuits the body at the first failed prerequisite (clean-body ergonomics)', async () => {
    // device present, but no snapshot -> i2s() throws before the send runs.
    session.device = fakeDevice;
    const sent = vi.fn(async () => Result.ok());
    await run('setBck', () => {
      device();
      i2s();           // throws NotReady('I2S config')
      return send('set bck', sent);
    });
    expect(sent).not.toHaveBeenCalled();
  });
});

describe('capture boundary', () => {
  it('returns Result.ok on a successful body', async () => {
    const r = await capture('setX', () => {});
    expect(r.ok).toBe(true);
  });

  it('maps a NotReady precondition to a failed Result without rejecting', async () => {
    const r = await capture('setX', () => { device(); }); // no device -> NotReady
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('device not available');
  });

  it('maps a DeviceRejected to a failed Result carrying the device message', async () => {
    const r = await capture('setX', () => send('op', async () => Result.fail(0x02, 'GPIO pin already in use')));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('GPIO pin already in use');
  });

  it('maps an unexpected throw to a failed Result without rejecting', async () => {
    const r = await capture('setX', () => { throw new Error('boom'); });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe('boom');
  });
});
