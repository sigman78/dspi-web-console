import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as State from '@/state';
import { bootMock } from '@/runtime/boot';

beforeEach(() => { State.resetAppState(); State.resetRemoteState(); });
afterEach(() => { State.resetAppState(); State.resetRemoteState(); });

const lease = { peerLabel: 'peer', since: 0 };

describe('lease registry', () => {
  it('reads null once the record is removed even if clearLease never ran', async () => {
    await bootMock('rp2350');
    const rec = State.activeRecord()!;
    State.setLease(rec.id, lease);
    expect(State.leaseOf(rec.id)).toEqual(lease);

    State.dispatch({ t: 'removed', id: rec.id });
    expect(State.leaseOf(rec.id)).toBeNull();
  });

  it('activeLease follows the active record', async () => {
    await bootMock('rp2350');
    const a = State.activeRecord()!;
    await bootMock('rp2350');
    const b = State.activeRecord()!;
    State.setLease(a.id, lease);

    expect(State.activeLease()).toBeNull();
    State.dispatch({ t: 'activated', id: a.id });
    expect(State.activeLease()).toEqual(lease);
    State.dispatch({ t: 'activated', id: b.id });
    expect(State.activeLease()).toBeNull();
  });

  it('an effect over activeLease re-runs after setLease and clearLease', async () => {
    await bootMock('rp2350');
    const rec = State.activeRecord()!;
    const seen: Array<State.Lease | null> = [];
    const stop = $effect.root(() => {
      $effect(() => { seen.push(State.activeLease()); });
    });
    await Promise.resolve();
    State.setLease(rec.id, lease);
    await Promise.resolve();
    State.clearLease(rec.id);
    await Promise.resolve();
    stop();

    expect(seen).toEqual([null, lease, null]);
  });
});
