import { describe, it, expect, vi, afterEach } from 'vitest';
import { watchPeerLiveness, wrapDataChannel, DISCONNECTED_GRACE_MS } from './peer';

function fakePc(): { pc: RTCPeerConnection; set(state: RTCPeerConnectionState): void } {
  const target = new EventTarget();
  const pc = Object.assign(target, { connectionState: 'connected' as RTCPeerConnectionState });
  return {
    pc: pc as unknown as RTCPeerConnection,
    set: (state) => {
      pc.connectionState = state;
      target.dispatchEvent(new Event('connectionstatechange'));
    },
  };
}

afterEach(() => vi.useRealTimers());

describe('watchPeerLiveness', () => {
  it('reports a failed connection immediately', () => {
    const { pc, set } = fakePc();
    const lost = vi.fn();
    watchPeerLiveness(pc, lost);
    set('failed');
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('waits out the grace period when disconnected', () => {
    vi.useFakeTimers();
    const { pc, set } = fakePc();
    const lost = vi.fn();
    watchPeerLiveness(pc, lost);
    set('disconnected');
    vi.advanceTimersByTime(DISCONNECTED_GRACE_MS - 1);
    expect(lost).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('forgets a disconnect that heals', () => {
    vi.useFakeTimers();
    const { pc, set } = fakePc();
    const lost = vi.fn();
    watchPeerLiveness(pc, lost);
    set('disconnected');
    set('connected');
    vi.advanceTimersByTime(DISCONNECTED_GRACE_MS * 2);
    expect(lost).not.toHaveBeenCalled();
  });

  it('stays quiet after stop', () => {
    const { pc, set } = fakePc();
    const lost = vi.fn();
    watchPeerLiveness(pc, lost)();
    set('failed');
    expect(lost).not.toHaveBeenCalled();
  });
});

function fakeChannel(readyState: RTCDataChannelState = 'open') {
  const target = new EventTarget();
  const dc = Object.assign(target, {
    readyState,
    binaryType: 'blob',
    send: vi.fn(),
    close: vi.fn(() => { dc.readyState = 'closing'; }),
  });
  const pc = { close: vi.fn() };
  return {
    dc,
    pc,
    wrapped: wrapDataChannel(pc as unknown as RTCPeerConnection, dc as unknown as RTCDataChannel),
    receive: (bytes: number[]) => target.dispatchEvent(new MessageEvent('message', { data: new Uint8Array(bytes).buffer })),
    remoteClose: () => { dc.readyState = 'closed'; target.dispatchEvent(new Event('close')); },
  };
}

describe('wrapDataChannel', () => {
  it('delivers frames that arrived before the first subscriber, in order', async () => {
    const { wrapped, receive } = fakeChannel();
    receive([1]);
    receive([2]);
    const got: number[] = [];
    wrapped.onMessage((f) => got.push(f[0]!));
    receive([3]);
    await Promise.resolve();
    expect(got).toEqual([1, 2, 3]);
  });

  it('replays a close that happened before subscription', async () => {
    const { wrapped, remoteClose } = fakeChannel();
    remoteClose();
    const closed = vi.fn();
    wrapped.onClose(closed);
    await Promise.resolve();
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('throws on send when the channel is not open, like any lost peer', () => {
    const { wrapped } = fakeChannel('connecting');
    expect(() => wrapped.send(new Uint8Array([1]))).toThrow();
  });

  it('closes the peer connection only after the data channel has closed', () => {
    vi.useFakeTimers();
    const { wrapped, pc, remoteClose } = fakeChannel();
    wrapped.close();
    expect(pc.close).not.toHaveBeenCalled();
    remoteClose();
    expect(pc.close).toHaveBeenCalledTimes(1);
  });

  it('still closes the peer connection if the data channel never reports closing', () => {
    vi.useFakeTimers();
    const { wrapped, dc, pc } = fakeChannel();
    dc.close.mockImplementation(() => {});
    wrapped.close();
    vi.advanceTimersByTime(5000);
    expect(pc.close).toHaveBeenCalledTimes(1);
  });
});

describe('watchPeerLiveness on subscribe', () => {
  it('reports a connection that already failed', () => {
    const { pc } = fakePc();
    (pc as unknown as { connectionState: string }).connectionState = 'failed';
    const lost = vi.fn();
    watchPeerLiveness(pc, lost);
    expect(lost).toHaveBeenCalledTimes(1);
  });
});
