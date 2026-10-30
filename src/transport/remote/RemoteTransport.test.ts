import { describe, it, expect, vi, afterEach } from 'vitest';
import { RemoteTransport } from './RemoteTransport';
import { RemoteClosed, RemoteRefused } from './errors';
import type { FrameChannel } from './FrameChannel';
import * as Frames from './frames';
import { TimeoutError } from '../withTimeout';

function fakeChannel() {
  const sent: Frames.Frame[] = [];
  const messageListeners = new Set<(f: Uint8Array) => void>();
  const closeListeners = new Set<() => void>();
  const channel: FrameChannel = {
    send: (f) => { sent.push(Frames.decodeFrame(f)); },
    onMessage: (l) => { messageListeners.add(l); return () => { messageListeners.delete(l); }; },
    onClose: (l) => { closeListeners.add(l); return () => { closeListeners.delete(l); }; },
    close: () => {},
  };
  const failSends = { on: false };
  const sendOrThrow = channel.send;
  channel.send = (f) => { if (failSends.on) throw new Error('InvalidStateError'); sendOrThrow(f); };
  return {
    failSends,
    channel,
    sent,
    reply: (f: Frames.Frame) => messageListeners.forEach((l) => l(Frames.encodeFrame(f))),
    drop: () => closeListeners.forEach((l) => l()),
    idOf: (n: number) => {
      const f = sent[n];
      if (!('id' in f)) throw new Error('frame has no id');
      return f.id;
    },
  };
}

const OPTS = { consoleBuild: 'test', wantReadOnly: false };

// sent[0] is always the HELLO; requests start at sent[1].
async function openRemote(hasNotify = true) {
  const fake = fakeChannel();
  const connecting = RemoteTransport.connect(fake.channel, OPTS);
  fake.reply({ type: 'welcome', version: Frames.TUNNEL_VERSION, leaseKind: 0, hasNotify, consoleBuild: 'peer' });
  return { fake, t: await connecting };
}

afterEach(() => { vi.useRealTimers(); });

describe('RemoteTransport', () => {
  it('reports the time from sending a control read to its answer, and only for reads', async () => {
    vi.useFakeTimers();
    const samples: number[] = [];
    const fake = fakeChannel();
    const connecting = RemoteTransport.connect(fake.channel, { ...OPTS, onRoundTrip: (ms) => { samples.push(ms); } });
    fake.reply({ type: 'welcome', version: Frames.TUNNEL_VERSION, leaseKind: 0, hasNotify: true, consoleBuild: 'peer' });
    const t = await connecting;

    const read = t.ctrlIn(0x11, 0, 1);
    await vi.advanceTimersByTimeAsync(7);
    fake.reply({ type: 'ok', id: fake.idOf(1), data: Uint8Array.of(1) });
    await read;
    expect(samples).toEqual([7]);

    const write = t.ctrlOut(0x40, 0, Uint8Array.of(1));
    fake.reply({ type: 'ok', id: fake.idOf(2), data: new Uint8Array(0) });
    await write;
    expect(samples).toEqual([7]);
  });

  it('matches responses to requests by id when they arrive out of order', async () => {
    const { fake, t } = await openRemote();
    const a = t.ctrlIn(0x11, 0, 1);
    const b = t.ctrlIn(0x13, 0, 1);
    fake.reply({ type: 'ok', id: fake.idOf(2), data: Uint8Array.of(2) });
    fake.reply({ type: 'ok', id: fake.idOf(1), data: Uint8Array.of(1) });
    expect(await a).toEqual(Uint8Array.of(1));
    expect(await b).toEqual(Uint8Array.of(2));
  });

  it('rejects ERR kind 2 with a TimeoutError carrying the peer message', async () => {
    const { fake, t } = await openRemote();
    const p = t.ctrlIn(0x11, 0, 1);
    fake.reply({ type: 'err', id: fake.idOf(1), kind: Frames.ErrKind.Timeout, message: 'ctrlIn(0x11, w=0) did not complete within 2000ms' });
    const err = await p.catch((e) => e);
    expect(err).toBeInstanceOf(TimeoutError);
    expect(err.message).toBe('ctrlIn(0x11, w=0) did not complete within 2000ms');
  });

  it('rejects ERR kind 1 with the message verbatim', async () => {
    const { fake, t } = await openRemote();
    const p = t.ctrlOut(0x40, 0, Uint8Array.of(1));
    fake.reply({ type: 'err', id: fake.idOf(1), kind: Frames.ErrKind.Transport, message: 'controlTransferOut status=stall' });
    const err = await p.catch((e) => e);
    expect(err).not.toBeInstanceOf(TimeoutError);
    expect(err.message).toBe('controlTransferOut status=stall');
  });

  it('rejects ERR kind 4 with RemoteRefused', async () => {
    const { fake, t } = await openRemote();
    const p = t.ctrlOut(0xf0, 0, new Uint8Array(0));
    fake.reply({ type: 'err', id: fake.idOf(1), kind: Frames.ErrKind.Refused, message: 'refused' });
    await expect(p).rejects.toBeInstanceOf(RemoteRefused);
  });

  it('ignores a late answer for a request that already settled', async () => {
    const { fake, t } = await openRemote();
    const p = t.ctrlIn(0x11, 0, 1);
    const id = fake.idOf(1);
    fake.reply({ type: 'ok', id, data: Uint8Array.of(9) });
    await p;
    expect(() => fake.reply({ type: 'err', id, kind: 1, message: 'late' })).not.toThrow();
    expect(t.isOpen()).toBe(true);
  });

  it('lets a CTRL_IN resolve while a NOTIFY_IN is still pending', async () => {
    const { fake, t } = await openRemote();
    let notified = false;
    void t.notifyIn!(8).then(() => { notified = true; });
    const ctrl = t.ctrlIn(0x11, 0, 1);
    fake.reply({ type: 'ok', id: fake.idOf(2), data: Uint8Array.of(5) });
    expect(await ctrl).toEqual(Uint8Array.of(5));
    expect(notified).toBe(false);
  });

  it('rejects every pending request and emits disconnect once when the channel closes', async () => {
    const { fake, t } = await openRemote();
    let disconnects = 0;
    t.on('disconnect', () => { disconnects++; });
    const a = t.ctrlIn(0x11, 0, 1);
    const b = t.notifyIn!(8);
    fake.drop();
    fake.drop();
    await expect(a).rejects.toBeInstanceOf(RemoteClosed);
    await expect(b).rejects.toBeInstanceOf(RemoteClosed);
    expect(disconnects).toBe(1);
    expect(t.isOpen()).toBe(false);
  });

  it('treats a release event as a close', async () => {
    const { fake, t } = await openRemote();
    let disconnects = 0;
    t.on('disconnect', () => { disconnects++; });
    const p = t.ctrlIn(0x11, 0, 1);
    fake.reply({ type: 'event', event: Frames.DeviceEvent.Release });
    await expect(p).rejects.toBeInstanceOf(RemoteClosed);
    expect(disconnects).toBe(1);
  });

  it('rejects connect() when the peer rejects the connection', async () => {
    const fake = fakeChannel();
    const connecting = RemoteTransport.connect(fake.channel, OPTS);
    fake.reply({ type: 'reject', reason: Frames.RejectReason.Busy });
    await expect(connecting).rejects.toThrow();
  });

  it('rejects connect() when the channel closes before WELCOME', async () => {
    const fake = fakeChannel();
    const connecting = RemoteTransport.connect(fake.channel, OPTS);
    fake.drop();
    await expect(connecting).rejects.toBeInstanceOf(RemoteClosed);
  });

  it('rejects connect() when the peer stays silent for 5 s', async () => {
    vi.useFakeTimers();
    const fake = fakeChannel();
    const connecting = RemoteTransport.connect(fake.channel, OPTS);
    const outcome = connecting.catch((e) => e);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await outcome).toBeInstanceOf(Error);
  });

  it('rejects connect() when the peer speaks another tunnel version', async () => {
    const fake = fakeChannel();
    const connecting = RemoteTransport.connect(fake.channel, OPTS);
    fake.reply({ type: 'welcome', version: Frames.TUNNEL_VERSION + 1, leaseKind: 0, hasNotify: true, consoleBuild: 'peer' });
    await expect(connecting).rejects.toThrow();
  });

  it('rejects connect() when HELLO cannot be sent', async () => {
    const fake = fakeChannel();
    fake.failSends.on = true;
    await expect(RemoteTransport.connect(fake.channel, OPTS)).rejects.toBeInstanceOf(RemoteClosed);
  });

  it('rejects a request whose frame cannot be sent, without leaking it as pending', async () => {
    const { fake, t } = await openRemote();
    fake.failSends.on = true;
    await expect(t.ctrlIn(0x11, 0, 1)).rejects.toBeInstanceOf(RemoteClosed);
    fake.failSends.on = false;
    const next = t.ctrlIn(0x11, 0, 1);
    fake.reply({ type: 'ok', id: fake.idOf(fake.sent.length - 1), data: Uint8Array.of(1) });
    expect(await next).toEqual(Uint8Array.of(1));
  });

  it('open() fails once the channel has closed', async () => {
    const { fake, t } = await openRemote();
    await expect(t.open()).resolves.toBeUndefined();
    fake.drop();
    await expect(t.open()).rejects.toBeInstanceOf(RemoteClosed);
  });

  it('omits notifyIn when the peer has no notify endpoint', async () => {
    const { t } = await openRemote(false);
    expect(t.notifyIn).toBeUndefined();
  });
});
