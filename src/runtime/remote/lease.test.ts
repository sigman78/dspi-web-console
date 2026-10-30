import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as State from '@/state';
import { bootMock } from '@/runtime/boot';
import { activateRecord, switchSession } from '@/runtime/deviceService';
import { RemoteTransport } from '@/transport/remote/RemoteTransport';
import type { FrameChannel } from '@/transport/remote/FrameChannel';
import { createFrameChannelPair } from '@test/fixtures/frameChannelPair';
import { prepareLend, attachLend, abortLend, reclaim, type AttachOptions } from './lease';

beforeEach(() => { State.resetAppState(); State.resetRemoteState(); });
afterEach(() => {
  for (const rec of State.sessionRecords().values()) rec.session.dispose();
  State.resetAppState();
  State.resetRemoteState();
});

// Prepares and attaches a lend; returns the lessee's end of the channel.
async function lend(peerLabel = 'B', opts?: AttachOptions): Promise<FrameChannel> {
  const [bSide, aSide] = createFrameChannelPair();
  expect(await prepareLend({ peerLabel })).toBe(true);
  expect(attachLend(aSide, opts)).toBe(true);
  return bSide;
}

function watchClose(channel: FrameChannel): { closed: boolean } {
  const flag = { closed: false };
  channel.onClose(() => { flag.closed = true; });
  return flag;
}

describe('prepareLend', () => {
  it('stops the loops, sets the lease and the lent share state', async () => {
    await bootMock('rp2350');
    const rec = State.activeRecord()!;
    expect(rec.loops).not.toBeNull();

    await lend();

    expect(rec.loops).toBeNull();
    expect(State.leaseOf(rec.id)?.peerLabel).toBe('B');
    expect(State.shareState()).toBe('lent');
  });

  it('activateRecord on a lent record does not restart loops', async () => {
    await bootMock('rp2350');
    const rec = State.activeRecord()!;
    await lend();

    activateRecord(rec);
    expect(rec.loops).toBeNull();
  });

  it('holds the lease while the flush is still running, so a promotion cannot restart loops', async () => {
    await bootMock('rp2350');
    const rec = State.activeRecord()!;

    const preparing = prepareLend({ peerLabel: 'B' });
    // The flush is in flight: the lease is already up.
    expect(State.leaseOf(rec.id)).not.toBeNull();
    activateRecord(rec);
    expect(rec.loops).toBeNull();
    await preparing;
  });

  it('refuses a second lessee and leaves the first lease intact', async () => {
    await bootMock('rp2350');
    const rec = State.activeRecord()!;
    await lend('B1');

    expect(await prepareLend({ peerLabel: 'B2' })).toBe(false);
    expect(State.leaseOf(rec.id)?.peerLabel).toBe('B1');
  });

  it('refuses a record that is itself remote', async () => {
    await bootMock('rp2350');
    const rec = State.activeRecord()!;
    State.dispatch({
      t: 'synced', id: State.mintConnId(), session: rec.session, remote: { peerLabel: 'host' },
    });

    expect(await prepareLend({ peerLabel: 'B' })).toBe(false);
  });

  it('declining the pending-changes prompt aborts the lend without touching loops', async () => {
    await bootMock('rp2350');
    const rec = State.activeRecord()!;
    rec.session.staging.entries.push({} as never);
    const loops = rec.loops;

    const pending = prepareLend({ peerLabel: 'B' });
    await Promise.resolve();
    expect(State.boundary.pending).not.toBeNull();
    State.resolveBoundary('cancel');

    expect(await pending).toBe(false);
    expect(rec.loops).toBe(loops);
    expect(State.leaseOf(rec.id)).toBeNull();
    rec.session.staging.entries.length = 0;
  });

  it('attach without a prepared lend refuses and closes the channel', () => {
    const [, aSide] = createFrameChannelPair();
    const closed = watchClose(aSide);
    expect(attachLend(aSide)).toBe(false);
    expect(closed.closed).toBe(true);
  });

  it('abortLend before attach clears the lease and restarts the loops', async () => {
    await bootMock('rp2350');
    const rec = State.activeRecord()!;
    expect(await prepareLend({ peerLabel: 'B' })).toBe(true);
    expect(rec.loops).toBeNull();

    abortLend();

    expect(State.leaseOf(rec.id)).toBeNull();
    expect(rec.loops).not.toBeNull();
  });

  it('a peer that sends HELLO while the prompt is open still gets WELCOME after attach', async () => {
    await bootMock('rp2350');
    const rec = State.activeRecord()!;
    rec.session.staging.entries.push({} as never);
    const [bSide, aSide] = createFrameChannelPair();

    const connecting = RemoteTransport.connect(bSide, { consoleBuild: 'b', wantReadOnly: false });
    const preparing = prepareLend({ peerLabel: 'B' });
    await Promise.resolve();
    State.resolveBoundary('discard');
    expect(await preparing).toBe(true);
    attachLend(aSide);

    const remote = await connecting;
    expect(remote.isOpen()).toBe(true);
    rec.session.staging.entries.length = 0;
  });

  it('switching to a lent record is refused', async () => {
    await bootMock('rp2350');
    const lent = State.activeRecord()!;
    await lend();
    await bootMock('rp2350');
    const other = State.activeRecord()!;
    expect(other.id).not.toBe(lent.id);

    expect(await switchSession(lent.id)).toBe(false);
    expect(State.activeRecord()?.id).toBe(other.id);
  });
});

describe('reclaim', () => {
  it('cancel restarts the loops, resyncs eagerly and keeps sharing; stop then ends sharing', async () => {
    await bootMock('rp2350');
    const rec = State.activeRecord()!;
    const bSide = await lend();
    const bClosed = watchClose(bSide);
    rec.session.mirror.consumeReconcile();

    reclaim('cancel');

    expect(State.leaseOf(rec.id)).toBeNull();
    expect(rec.loops).not.toBeNull();
    expect(rec.session.mirror.peekReconcile()).toEqual({ wanted: true, eager: true });
    expect(State.shareState()).toBe('sharing');
    await Promise.resolve();
    expect(bClosed.closed).toBe(true);

    await lend();
    reclaim('stop');
    expect(State.shareState()).toBe('idle');
  });

  it('a channel that closes under the lessee reclaims and keeps sharing', async () => {
    await bootMock('rp2350');
    const rec = State.activeRecord()!;
    const bSide = await lend();

    bSide.close();
    await Promise.resolve();

    expect(State.leaseOf(rec.id)).toBeNull();
    expect(rec.loops).not.toBeNull();
    expect(State.shareState()).toBe('sharing');
  });

  it('a lost peer connection reclaims', async () => {
    await bootMock('rp2350');
    const rec = State.activeRecord()!;
    let lost: () => void = () => {};
    await lend('B', { watchLiveness: (cb) => { lost = cb; return () => {}; } });

    lost();

    expect(State.leaseOf(rec.id)).toBeNull();
    expect(rec.loops).not.toBeNull();
    expect(State.shareState()).toBe('sharing');
  });

  it('the device going away ends the lease and sharing, closing the channel', async () => {
    await bootMock('rp2350');
    const rec = State.activeRecord()!;
    const bSide = await lend();
    const bClosed = watchClose(bSide);

    await rec.session.device.close();
    await Promise.resolve();

    expect(State.leaseOf(rec.id)).toBeNull();
    expect(State.shareState()).toBe('idle');
    expect(bClosed.closed).toBe(true);
  });
});
