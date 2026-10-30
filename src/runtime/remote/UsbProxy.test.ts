import { describe, it, expect } from 'vitest';
import { startUsbProxy } from './UsbProxy';
import { createLeasePolicy } from './allowlist';
import { WireCmd } from '@/protocol/wireCmd';
import type { SerializedDspTransport } from '@/transport/withSerializedCtrl';
import { TimeoutError } from '@/transport/withTimeout';
import type { DspTransport, TransportEvent } from '@/transport/DspTransport';
import type { FrameChannel } from '@/transport/remote/FrameChannel';
import * as Frames from '@/transport/remote/frames';
import { createFrameChannelPair } from '@test/fixtures/frameChannelPair';

// Deliberately does not queue: the proxy's own FIFO is what is under test.
const asSerialized = (inner: DspTransport): SerializedDspTransport => ({
  ...inner,
  exclusive: (fn) => fn(inner),
});

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

// Counts calls and in-flight overlap; every call settles after a few ticks
// unless `hold` is set, in which case ctrlIn waits for release().
function stubTransport(opts: { hold?: boolean } = {}) {
  const listeners = new Set<() => void>();
  const calls: Array<{ request: number; value: number }> = [];
  const held: Array<() => void> = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const run = async <T>(result: T, hold: boolean): Promise<T> => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    if (hold) await new Promise<void>((r) => held.push(r));
    else for (let i = 0; i < 4; i++) await Promise.resolve();
    inFlight--;
    return result;
  };
  const inner: DspTransport = {
    open: async () => {},
    close: async () => {},
    isOpen: () => true,
    on: (_e: TransportEvent, l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
    ctrlIn: (request, value) => {
      calls.push({ request, value });
      return run(Uint8Array.of(value & 0xff), opts.hold ?? false);
    },
    ctrlOut: (request, value) => {
      calls.push({ request, value });
      return run(undefined, false);
    },
    notifyIn: async () => Uint8Array.of(0xee),
  };
  return {
    transport: asSerialized(inner),
    calls,
    release: () => held.shift()?.(),
    maxInFlight: () => maxInFlight,
    disconnect: () => listeners.forEach((l) => l()),
    inner,
  };
}

async function connect(
  transport: SerializedDspTransport,
  readOnly = false,
) {
  const [peer, local] = createFrameChannelPair();
  const received: Frames.Frame[] = [];
  let peerClosed = false;
  const ended: Array<'peer' | 'device'> = [];
  peer.onMessage((f) => received.push(Frames.decodeFrame(f)));
  peer.onClose(() => { peerClosed = true; });
  const proxy = startUsbProxy(transport, local, createLeasePolicy(readOnly), {
    consoleBuild: 'test',
    onClosed: (reason) => { ended.push(reason); },
  });
  peer.send(Frames.encodeFrame({ type: 'hello', version: Frames.TUNNEL_VERSION, wantReadOnly: false, consoleBuild: 'b' }));
  await flush();
  return {
    peer,
    proxy,
    received,
    send: (f: Frames.Frame) => peer.send(Frames.encodeFrame(f)),
    closed: () => peerClosed,
    ended,
  };
}

const answers = (frames: Frames.Frame[]) =>
  frames.filter((f): f is Extract<Frames.Frame, { type: 'ok' | 'err' }> => f.type === 'ok' || f.type === 'err');

describe('startUsbProxy', () => {
  it('greets with the lease kind and notify support', async () => {
    const stub = stubTransport();
    const { received } = await connect(stub.transport, true);
    expect(received[0]).toMatchObject({ type: 'welcome', leaseKind: Frames.LeaseKind.ReadOnly, hasNotify: true });
  });

  it('rejects a HELLO speaking another tunnel version', async () => {
    const stub = stubTransport();
    const [peer, local] = createFrameChannelPair();
    const received: Frames.Frame[] = [];
    peer.onMessage((f) => received.push(Frames.decodeFrame(f)));
    startUsbProxy(stub.transport, local, createLeasePolicy(false), { consoleBuild: 't', onClosed: () => {} });
    peer.send(Frames.encodeFrame({ type: 'hello', version: 99, wantReadOnly: false, consoleBuild: 'b' }));
    await flush();
    expect(received[0]).toMatchObject({ type: 'reject', reason: Frames.RejectReason.Version });
  });

  it('runs ten simultaneous CTRL_INs one at a time, answered in arrival order', async () => {
    const stub = stubTransport();
    const c = await connect(stub.transport);
    for (let id = 1; id <= 10; id++) {
      c.send({ type: 'ctrlIn', id, request: WireCmd.GetSerial.code, value: id, length: 1 });
    }
    await flush();
    const got = answers(c.received);
    expect(got.map((f) => f.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(got.every((f) => f.type === 'ok')).toBe(true);
    expect(stub.maxInFlight()).toBe(1);
  });

  it('answers a NOTIFY_IN while a CTRL_IN is still pending', async () => {
    const stub = stubTransport({ hold: true });
    const c = await connect(stub.transport);
    c.send({ type: 'ctrlIn', id: 1, request: WireCmd.GetSerial.code, value: 0, length: 1 });
    c.send({ type: 'notifyIn', id: 2, length: 8 });
    await flush();
    expect(answers(c.received).map((f) => f.id)).toEqual([2]);
    stub.release();
    await flush();
    expect(answers(c.received).map((f) => f.id)).toEqual([2, 1]);
  });

  it('refuses a second NOTIFY_IN while one is outstanding', async () => {
    const stub = stubTransport();
    let finishNotify: () => void = () => {};
    stub.inner.notifyIn = () => new Promise<Uint8Array>((r) => { finishNotify = () => r(Uint8Array.of(1)); });
    const c = await connect(asSerialized(stub.inner));
    c.send({ type: 'notifyIn', id: 1, length: 8 });
    c.send({ type: 'notifyIn', id: 2, length: 8 });
    await flush();
    expect(answers(c.received)).toMatchObject([{ id: 2, type: 'err', kind: Frames.ErrKind.Transport }]);
    finishNotify();
  });

  it('never forwards hard-refused or unknown commands', async () => {
    const stub = stubTransport();
    const c = await connect(stub.transport);
    const known = new Set(Object.values(WireCmd).map((e) => e.code));
    let unknown = 0;
    while (known.has(unknown)) unknown++;
    c.send({ type: 'ctrlIn', id: 1, request: WireCmd.EnterBootloader.code, value: 0, length: 0 });
    c.send({ type: 'ctrlOut', id: 2, request: WireCmd.FactoryReset.code, value: 0, data: new Uint8Array(0) });
    c.send({ type: 'ctrlIn', id: 3, request: unknown, value: 0, length: 1 });
    await flush();
    expect(answers(c.received).map((f) => f.type === 'err' && f.kind)).toEqual([4, 4, 4]);
    expect(stub.calls).toEqual([]);
  });

  it('refuses an oversize request length', async () => {
    const stub = stubTransport();
    const c = await connect(stub.transport);
    c.send({ type: 'ctrlIn', id: 1, request: WireCmd.GetSerial.code, value: 0, length: Frames.MAX_PAYLOAD + 1 });
    await flush();
    expect(answers(c.received)).toMatchObject([{ type: 'err', kind: Frames.ErrKind.Refused }]);
    expect(stub.calls).toEqual([]);
  });

  it('under read-only lets reads through and refuses every CTRL_OUT and non-read IN', async () => {
    const stub = stubTransport();
    const c = await connect(stub.transport, true);
    c.send({ type: 'ctrlIn', id: 1, request: WireCmd.GetMasterVolume.code, value: 0, length: 4 });
    c.send({ type: 'ctrlIn', id: 2, request: WireCmd.PresetGetName.code, value: 0, length: 32 });
    c.send({ type: 'ctrlIn', id: 3, request: WireCmd.Limiter.code, value: 0, length: 4 });
    c.send({ type: 'ctrlIn', id: 4, request: WireCmd.PresetSave.code, value: 0, length: 1 });
    c.send({ type: 'ctrlOut', id: 5, request: WireCmd.SetMasterVolume.code, value: 0, data: new Uint8Array(4) });
    await flush();
    expect(answers(c.received).map((f) => [f.id, f.type === 'ok' ? 'ok' : f.kind])).toEqual([
      [1, 'ok'], [2, 'ok'], [3, 'ok'], [4, Frames.ErrKind.Refused], [5, Frames.ErrKind.Refused],
    ]);
    expect(stub.calls).toHaveLength(3);
  });

  it('maps a transport TimeoutError to ERR kind 2 and other failures to kind 1', async () => {
    const stub = stubTransport();
    let n = 0;
    stub.inner.ctrlIn = async () => {
      if (n++ === 0) throw new TimeoutError('ctrlIn', 5);
      throw new Error('status=stall');
    };
    const c = await connect(asSerialized(stub.inner));
    c.send({ type: 'ctrlIn', id: 1, request: WireCmd.GetSerial.code, value: 0, length: 1 });
    c.send({ type: 'ctrlIn', id: 2, request: WireCmd.GetSerial.code, value: 0, length: 1 });
    await flush();
    expect(answers(c.received)).toMatchObject([
      { id: 1, type: 'err', kind: Frames.ErrKind.Timeout },
      { id: 2, type: 'err', kind: Frames.ErrKind.Transport, message: 'status=stall' },
    ]);
  });

  it('reports a closed device as ERR kind 5', async () => {
    const stub = stubTransport();
    stub.inner.isOpen = () => false;
    stub.inner.ctrlIn = async () => { throw new Error('device not open'); };
    const c = await connect(asSerialized(stub.inner));
    c.send({ type: 'ctrlIn', id: 1, request: WireCmd.GetSerial.code, value: 0, length: 1 });
    await flush();
    expect(answers(c.received)).toMatchObject([{ type: 'err', kind: Frames.ErrKind.NotOpen }]);
  });

  it('sends EVENT disconnect then closes when the transport disconnects', async () => {
    const stub = stubTransport();
    const c = await connect(stub.transport);
    stub.disconnect();
    await flush();
    expect(c.received.at(-1)).toEqual({ type: 'event', event: Frames.DeviceEvent.Disconnect });
    expect(c.closed()).toBe(true);
    expect(c.ended).toEqual(['device']);
  });

  it('stop(release) sends EVENT release, closes, and does not call onClosed', async () => {
    const stub = stubTransport();
    const c = await connect(stub.transport);
    c.proxy.stop('release');
    await flush();
    expect(c.received.at(-1)).toEqual({ type: 'event', event: Frames.DeviceEvent.Release });
    expect(c.closed()).toBe(true);
    expect(c.ended).toEqual([]);
  });

  it('closes the channel on a second HELLO', async () => {
    const stub = stubTransport();
    const c = await connect(stub.transport);
    c.send({ type: 'hello', version: Frames.TUNNEL_VERSION, wantReadOnly: false, consoleBuild: 'b' });
    await flush();
    expect(c.closed()).toBe(true);
    expect(c.ended).toEqual(['peer']);
  });

  it('closes the channel on an oversize frame and on a request before HELLO', async () => {
    const stub = stubTransport();
    const c = await connect(stub.transport);
    c.peer.send(new Uint8Array(Frames.MAX_FRAME_BYTES + 1));
    await flush();
    expect(c.closed()).toBe(true);

    const [peer, local] = createFrameChannelPair();
    let closed = false;
    peer.onClose(() => { closed = true; });
    startUsbProxy(stub.transport, local, createLeasePolicy(false), { consoleBuild: 't', onClosed: () => {} });
    peer.send(Frames.encodeFrame({ type: 'ctrlIn', id: 1, request: WireCmd.GetSerial.code, value: 0, length: 1 }));
    await flush();
    expect(closed).toBe(true);
    expect(stub.calls).toEqual([]);
  });

  it('ends as a lost peer when the channel cannot send, and stops serving', async () => {
    const stub = stubTransport();
    const [peer, local] = createFrameChannelPair();
    let failSends = false;
    const flaky: FrameChannel = {
      ...local,
      send: (f) => { if (failSends) throw new Error('InvalidStateError'); local.send(f); },
    };
    const ended: string[] = [];
    startUsbProxy(stub.transport, flaky, createLeasePolicy(false), { consoleBuild: 't', onClosed: (r) => { ended.push(r); } });
    peer.send(Frames.encodeFrame({ type: 'hello', version: Frames.TUNNEL_VERSION, wantReadOnly: false, consoleBuild: 'b' }));
    await flush();
    failSends = true;
    peer.send(Frames.encodeFrame({ type: 'ctrlIn', id: 1, request: WireCmd.GetSerial.code, value: 0, length: 1 }));
    peer.send(Frames.encodeFrame({ type: 'ctrlIn', id: 2, request: WireCmd.GetSerial.code, value: 0, length: 1 }));
    await flush();
    expect(ended).toEqual(['peer']);
    expect(stub.calls).toHaveLength(1);
  });
});
