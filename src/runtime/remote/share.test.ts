import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as State from '@/state';
import { bootMock } from '@/runtime/boot';
import { createFrameChannelPair } from '@test/fixtures/frameChannelPair';
import { FakeWebSocket } from '@test/fixtures/fakeWebSocket';
import * as Manual from './manualSignaling';
import * as Peer from './peer';
import { startSharing, allow, deny, stopSharing, cancelLend } from './share';

vi.mock('./manualSignaling', () => ({ createOffer: vi.fn(), acceptAnswer: vi.fn(async () => {}) }));
vi.mock('./peer', () => ({ whenOpen: vi.fn(async () => {}), wrapDataChannel: vi.fn(), watchPeerLiveness: vi.fn(() => () => {}) }));

const ANSWER = { type: 'answer', sdp: 'ans' };

let leaseAtOffer: boolean[] = [];

beforeEach(() => {
  State.resetAppState();
  State.resetRemoteState();
  FakeWebSocket.reset();
  leaseAtOffer = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubEnv('VITE_REMOTE_RELAY', '/room');
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ roomId: 'room1', code: 'ABC234', scanKey: 'scan', hostToken: 'host-token' }),
  })));
  vi.mocked(Manual.createOffer).mockImplementation(async () => {
    const rec = State.activeRecord();
    leaseAtOffer.push(rec !== null && State.leaseOf(rec.id) !== null);
    return {
      pc: { close: vi.fn() } as unknown as RTCPeerConnection,
      dc: {} as RTCDataChannel,
      offer: JSON.stringify({ type: 'offer', sdp: 'off' }),
    };
  });
  vi.mocked(Peer.wrapDataChannel).mockImplementation(() => createFrameChannelPair()[1]);
});
afterEach(() => {
  stopSharing();
  for (const rec of State.sessionRecords().values()) rec.session.dispose();
  State.resetAppState();
  State.resetRemoteState();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

async function sharing(): Promise<FakeWebSocket> {
  await bootMock('rp2350');
  const started = startSharing();
  await vi.waitFor(() => { expect(FakeWebSocket.instances).toHaveLength(1); });
  const ws = FakeWebSocket.last();
  ws.open();
  ws.receive({ t: 'ready', code: 'ABC234', scanKey: 'scan' });
  expect(await started).toBe(true);
  return ws;
}

/** Drives a typed-code joiner through Allow until the device is lent. */
async function lent(ws: FakeWebSocket): Promise<void> {
  ws.receive({ t: 'peer', peerId: 'p1', via: 'code', label: 'Windows · Chrome · amber-fox' });
  allow();
  await vi.waitFor(() => { expect(ws.messages().some((m) => m.t === 'sdp')).toBe(true); });
  ws.receive({ t: 'sdp', peerId: 'p1', sdp: ANSWER });
  await vi.waitFor(() => { expect(State.sharePeer()).toBeNull(); });
  expect(State.shareState()).toBe('lent');
}

describe('starting', () => {
  it('opens a room, authenticates and shows the code', async () => {
    const ws = await sharing();
    expect(ws.url).toMatch(/\/room\/room1\/ws$/);
    expect(ws.messages()[0]).toEqual({ t: 'host', token: 'host-token' });
    expect(State.shareState()).toBe('sharing');
    expect(State.shareRoom()).toEqual({ code: 'ABC234', scanKey: 'scan' });
  });

  it('does nothing when the build has no relay', async () => {
    vi.stubEnv('VITE_REMOTE_RELAY', '');
    expect(await startSharing()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(State.shareState()).toBe('idle');
  });

  it('fails and stays idle when the relay refuses the connection', async () => {
    const started = startSharing();
    await vi.waitFor(() => { expect(FakeWebSocket.instances).toHaveLength(1); });
    FakeWebSocket.last().drop();
    await expect(started).rejects.toThrow();
    expect(State.shareState()).toBe('idle');
    expect(State.shareRoom()).toBeNull();
  });
});

describe('a typed-code joiner', () => {
  it('waits for the owner, who is asked before the device is touched', async () => {
    const ws = await sharing();
    ws.receive({ t: 'peer', peerId: 'p1', via: 'code', label: 'Win' });
    expect(State.sharePeer()).toEqual({ peerId: 'p1', label: 'Win', stage: 'pending' });
    expect(Manual.createOffer).not.toHaveBeenCalled();
    expect(State.activeLease()).toBeNull();
  });

  it('prepares the lend before offering, then allows and lends', async () => {
    const ws = await sharing();
    await lent(ws);
    expect(leaseAtOffer).toEqual([true]);
    const sent = ws.messages().map((m) => m.t);
    expect(sent.indexOf('allow')).toBeGreaterThan(-1);
    expect(sent.indexOf('allow')).toBeLessThan(sent.indexOf('sdp'));
    expect(ws.messages().find((m) => m.t === 'sdp')).toMatchObject({ peerId: 'p1', sdp: { type: 'offer' } });
    expect(State.activeLease()?.peerLabel).toBe('Windows · Chrome · amber-fox');
    expect(State.sharePeer()).toBeNull();
  });

  it('deny tells the relay and follows the rotated code', async () => {
    const ws = await sharing();
    ws.receive({ t: 'peer', peerId: 'p1', via: 'code', label: 'Win' });
    deny();
    expect(ws.messages()).toContainEqual({ t: 'deny', peerId: 'p1' });
    expect(State.sharePeer()).toBeNull();
    ws.receive({ t: 'rotated', code: 'XYZ789', scanKey: 'scan2' });
    expect(State.shareRoom()).toEqual({ code: 'XYZ789', scanKey: 'scan2' });
    expect(State.shareState()).toBe('sharing');
  });

  it('leaving before the decision clears the pending joiner', async () => {
    const ws = await sharing();
    ws.receive({ t: 'peer', peerId: 'p1', via: 'code', label: 'Win' });
    ws.receive({ t: 'peer-gone', peerId: 'p1' });
    expect(State.sharePeer()).toBeNull();
    expect(State.shareState()).toBe('sharing');
  });

  it('a stale peer-gone does not cancel a newer joiner', async () => {
    const ws = await sharing();
    ws.receive({ t: 'peer', peerId: 'old', via: 'code', label: 'Win' });
    ws.receive({ t: 'peer', peerId: 'new', via: 'code', label: 'Win' });
    ws.receive({ t: 'peer-gone', peerId: 'old' });
    expect(State.sharePeer()?.peerId).toBe('new');
  });

  it('is turned away when the owner has no device to lend', async () => {
    const ws = await sharing();
    for (const rec of State.sessionRecords().values()) rec.session.dispose();
    State.resetAppState();
    ws.receive({ t: 'peer', peerId: 'p1', via: 'code', label: 'Win' });
    allow();
    await vi.waitFor(() => { expect(ws.messages()).toContainEqual({ t: 'deny', peerId: 'p1' }); });
    expect(Manual.createOffer).not.toHaveBeenCalled();
    expect(State.sharePeer()).toBeNull();
  });
});

describe('a scanned or returning joiner', () => {
  it('is served without an Allow', async () => {
    const ws = await sharing();
    ws.receive({ t: 'peer', peerId: 'p1', via: 'scan', label: 'Win' });
    await vi.waitFor(() => { expect(ws.messages().some((m) => m.t === 'sdp')).toBe(true); });
    expect(ws.messages().some((m) => m.t === 'allow')).toBe(false);
    expect(leaseAtOffer).toEqual([true]);
  });

  it('needs an Allow again after Cancel', async () => {
    const ws = await sharing();
    await lent(ws);
    cancelLend();
    expect(ws.messages()).toContainEqual({ t: 'reclaim' });
    expect(State.shareState()).toBe('sharing');
    expect(State.activeLease()).toBeNull();

    ws.receive({ t: 'peer', peerId: 'p2', via: 'resume', label: 'Win' });
    expect(State.sharePeer()).toEqual({ peerId: 'p2', label: 'Win', stage: 'pending' });
    expect(Manual.createOffer).toHaveBeenCalledTimes(1);
  });

  it('comes back silently after a lost connection', async () => {
    const ws = await sharing();
    await lent(ws);
    ws.receive({ t: 'peer', peerId: 'p2', via: 'resume', label: 'Win' });
    await vi.waitFor(() => { expect(Manual.createOffer).toHaveBeenCalledTimes(2); });
    expect(ws.messages().filter((m) => m.t === 'sdp')).toHaveLength(2);
  });
});

describe('handshake failures', () => {
  it('releases the device and keeps sharing when the channel never opens', async () => {
    vi.mocked(Peer.whenOpen).mockRejectedValueOnce(new Error('ice failed'));
    const ws = await sharing();
    ws.receive({ t: 'peer', peerId: 'p1', via: 'scan', label: 'Win' });
    await vi.waitFor(() => { expect(ws.messages().some((m) => m.t === 'sdp')).toBe(true); });
    ws.receive({ t: 'sdp', peerId: 'p1', sdp: ANSWER });
    await vi.waitFor(() => { expect(State.sharePeer()).toBeNull(); });
    expect(State.shareState()).toBe('sharing');
    expect(State.activeLease()).toBeNull();
  });

  it('the joiner leaving mid-handshake releases the device', async () => {
    const ws = await sharing();
    ws.receive({ t: 'peer', peerId: 'p1', via: 'scan', label: 'Win' });
    await vi.waitFor(() => { expect(ws.messages().some((m) => m.t === 'sdp')).toBe(true); });
    ws.receive({ t: 'peer-gone', peerId: 'p1' });
    expect(State.sharePeer()).toBeNull();
    expect(State.shareState()).toBe('sharing');
    expect(State.activeLease()).toBeNull();
  });
});

describe('ending', () => {
  it('stop closes the room and takes the device back', async () => {
    const ws = await sharing();
    await lent(ws);
    stopSharing();
    expect(ws.messages()).toContainEqual({ t: 'close' });
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
    expect(State.shareState()).toBe('idle');
    expect(State.shareRoom()).toBeNull();
    expect(State.activeLease()).toBeNull();
  });

  it('losing the relay socket while lent keeps the lend and goes idle when it ends', async () => {
    const ws = await sharing();
    await lent(ws);
    const rec = State.activeRecord()!;
    ws.drop();
    expect(State.shareRoom()).toBeNull();
    expect(State.shareEnd()).toBe('relay-lost');
    expect(State.shareState()).toBe('lent');
    expect(State.leaseOf(rec.id)).not.toBeNull();

    cancelLend();
    expect(State.shareState()).toBe('idle');
    expect(State.leaseOf(rec.id)).toBeNull();
    expect(rec.loops).not.toBeNull();
  });

  it('losing the relay socket while only sharing goes idle', async () => {
    const ws = await sharing();
    ws.drop();
    expect(State.shareState()).toBe('idle');
    expect(State.shareRoom()).toBeNull();
    expect(State.shareEnd()).toBe('relay-lost');
  });

  it('the local device going away closes the room', async () => {
    const ws = await sharing();
    await lent(ws);
    State.activeRecord()!.session.dispose();
    expect(State.shareState()).toBe('idle');
    expect(ws.messages()).toContainEqual({ t: 'close' });
    expect(State.shareRoom()).toBeNull();
  });
});

/** Waits until the owner has offered to `peerId`. */
async function offered(ws: FakeWebSocket, count = 1): Promise<void> {
  await vi.waitFor(() => { expect(ws.messages().filter((m) => m.t === 'sdp')).toHaveLength(count); });
}

describe('overlapping joiners', () => {
  it('a joiner that replaces an unanswered handshake still gets its lend', async () => {
    const ws = await sharing();
    ws.receive({ t: 'peer', peerId: 'p1', via: 'scan', needsAllow: false, label: 'Win' });
    await offered(ws);
    ws.receive({ t: 'peer', peerId: 'p2', via: 'resume', needsAllow: false, label: 'Win' });
    await offered(ws, 2);
    ws.receive({ t: 'sdp', peerId: 'p2', sdp: ANSWER });
    await vi.waitFor(() => { expect(State.sharePeer()).toBeNull(); });
    expect(State.shareState()).toBe('lent');
    expect(State.activeLease()).not.toBeNull();
  });

  it('a code or scan joiner cannot take a running lend', async () => {
    const ws = await sharing();
    await lent(ws);
    ws.receive({ t: 'peer', peerId: 'p2', via: 'scan', needsAllow: false, label: 'Other' });
    expect(State.activeLease()?.peerLabel).toBe('Windows · Chrome · amber-fox');
    expect(State.sharePeer()).toBeNull();
    expect(Manual.createOffer).toHaveBeenCalledTimes(1);
  });

  it('an answer for another joiner is ignored', async () => {
    const ws = await sharing();
    ws.receive({ t: 'peer', peerId: 'p1', via: 'scan', needsAllow: false, label: 'Win' });
    await offered(ws);
    ws.receive({ t: 'sdp', peerId: 'someone-else', sdp: ANSWER });
    await Promise.resolve();
    expect(Manual.acceptAnswer).not.toHaveBeenCalled();
  });

  it('the relay requirement can make a resume stricter than the owner expects', async () => {
    const ws = await sharing();
    ws.receive({ t: 'peer', peerId: 'p1', via: 'resume', needsAllow: true, label: 'Win' });
    expect(State.sharePeer()?.stage).toBe('pending');
  });
});

describe('cancelling mid-handshake', () => {
  it('drops the offer and releases the device', async () => {
    const ws = await sharing();
    ws.receive({ t: 'peer', peerId: 'p1', via: 'scan', needsAllow: false, label: 'Win' });
    await offered(ws);
    cancelLend();
    expect(State.sharePeer()).toBeNull();
    expect(State.activeLease()).toBeNull();
    expect(State.shareState()).toBe('sharing');
    ws.receive({ t: 'sdp', peerId: 'p1', sdp: ANSWER });
    await Promise.resolve();
    expect(Manual.acceptAnswer).not.toHaveBeenCalled();
  });

  it('a joiner that left after answering does not abort the channel wait', async () => {
    let open!: () => void;
    vi.mocked(Peer.whenOpen).mockReturnValueOnce(new Promise<void>((resolve) => { open = resolve; }));
    const ws = await sharing();
    ws.receive({ t: 'peer', peerId: 'p1', via: 'scan', needsAllow: false, label: 'Win' });
    await offered(ws);
    ws.receive({ t: 'sdp', peerId: 'p1', sdp: ANSWER });
    await vi.waitFor(() => { expect(Peer.whenOpen).toHaveBeenCalled(); });
    ws.receive({ t: 'peer-gone', peerId: 'p1' });
    open();
    await vi.waitFor(() => { expect(State.sharePeer()).toBeNull(); });
    expect(State.shareState()).toBe('lent');
  });
});

describe('declined lend', () => {
  it('tells a scanned joiner at once when the owner declines the pending-changes prompt', async () => {
    const ws = await sharing();
    const rec = State.activeRecord()!;
    rec.session.staging.entries.push({} as never);
    ws.receive({ t: 'peer', peerId: 'p1', via: 'scan', needsAllow: false, label: 'Win' });
    await vi.waitFor(() => { expect(State.boundary.pending).not.toBeNull(); });
    State.resolveBoundary('cancel');
    await vi.waitFor(() => { expect(ws.messages()).toContainEqual({ t: 'deny', peerId: 'p1' }); });
    expect(Manual.createOffer).not.toHaveBeenCalled();
    rec.session.staging.entries.length = 0;
  });
});

describe('timeouts', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('gives the device back when no answer comes', async () => {
    const ws = await sharing();
    ws.receive({ t: 'peer', peerId: 'p1', via: 'scan', needsAllow: false, label: 'Win' });
    await offered(ws);
    await vi.advanceTimersByTimeAsync(30_001);
    expect(State.sharePeer()).toBeNull();
    expect(State.activeLease()).toBeNull();
    expect(State.shareState()).toBe('sharing');
  });

  it('gives the device back when the channel never opens', async () => {
    vi.mocked(Peer.whenOpen).mockReturnValueOnce(new Promise<void>(() => {}));
    const ws = await sharing();
    ws.receive({ t: 'peer', peerId: 'p1', via: 'scan', needsAllow: false, label: 'Win' });
    await offered(ws);
    ws.receive({ t: 'sdp', peerId: 'p1', sdp: ANSWER });
    await vi.advanceTimersByTimeAsync(30_001);
    expect(State.sharePeer()).toBeNull();
    expect(State.activeLease()).toBeNull();
    expect(State.shareState()).toBe('sharing');
  });

  it('closes the socket and fails when the relay never says ready', async () => {
    const started = startSharing();
    const failure = expect(started).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10_001);
    await failure;
    expect(FakeWebSocket.last().readyState).toBe(FakeWebSocket.CLOSED);
    expect(State.shareState()).toBe('idle');
  });
});
