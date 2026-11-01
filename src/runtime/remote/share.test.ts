import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as State from '@/state';
import { bootMock } from '@/runtime/boot';
import { createFrameChannelPair } from '@test/fixtures/frameChannelPair';
import { FakeWebSocket } from '@test/fixtures/fakeWebSocket';
import * as Lease from './lease';
import * as Manual from './manualSignaling';
import * as Peer from './peer';
import * as DeviceService from '@/runtime/deviceService';
import * as JoinRelay from './joinRelay';
import { startSharing, allow, deny, stopSharing, cancelLend } from './share';

vi.mock('./lease', async (importOriginal) => {
  const real = await importOriginal<typeof import('./lease')>();
  return { ...real, prepareLend: vi.fn(real.prepareLend), attachLend: vi.fn(real.attachLend) };
});
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
    expect(State.shareRoom()).toEqual({ code: 'ABC234', scanKey: 'scan', status: 'live' });
  });

  it('does nothing when the build has no relay', async () => {
    vi.stubEnv('VITE_REMOTE_RELAY', '');
    expect(await startSharing()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(State.shareState()).toBe('idle');
  });

  it('fails and stays idle when the relay refuses the connection', async () => {
    await bootMock('rp2350');
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
    expect(State.shareRoom()).toEqual({ code: 'XYZ789', scanKey: 'scan2', status: 'live' });
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

  it('is turned away when the shared device is no longer the active one', async () => {
    const ws = await sharing();
    await bootMock('rp2350');
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

  function offerWithPc(pc: object): void {
    vi.mocked(Manual.createOffer).mockResolvedValueOnce({
      pc: { close: vi.fn(), ...pc } as unknown as RTCPeerConnection,
      dc: {} as RTCDataChannel,
      offer: JSON.stringify({ type: 'offer', sdp: 'off' }),
    });
  }

  it('names the other console when our connection failed, until the next one arrives', async () => {
    offerWithPc({ iceConnectionState: 'failed' });
    vi.mocked(Peer.whenOpen).mockRejectedValueOnce(new Error('ice failed'));
    const ws = await sharing();
    ws.receive({ t: 'peer', peerId: 'p1', via: 'scan', label: 'Win' });
    await vi.waitFor(() => { expect(ws.messages().some((m) => m.t === 'sdp')).toBe(true); });
    ws.receive({ t: 'sdp', peerId: 'p1', sdp: ANSWER });
    await vi.waitFor(() => { expect(State.shareNoPath()).toBe('Win'); });
    expect(State.shareState()).toBe('sharing');

    ws.receive({ t: 'peer', peerId: 'p2', via: 'code', label: 'Mac' });
    expect(State.shareNoPath()).toBeNull();
  });

  it('a channel that fails to open without the connection failing is not blamed on the network', async () => {
    offerWithPc({ iceConnectionState: 'checking' });
    vi.mocked(Peer.whenOpen).mockRejectedValueOnce(new Error('closed'));
    const ws = await sharing();
    ws.receive({ t: 'peer', peerId: 'p1', via: 'scan', label: 'Win' });
    await vi.waitFor(() => { expect(ws.messages().some((m) => m.t === 'sdp')).toBe(true); });
    ws.receive({ t: 'sdp', peerId: 'p1', sdp: ANSWER });
    await vi.waitFor(() => { expect(State.sharePeer()).toBeNull(); });
    expect(State.shareNoPath()).toBeNull();
  });

  it('a joiner that left after answering is not blamed on the network, even if the channel then fails', async () => {
    offerWithPc({ iceConnectionState: 'failed' });
    let fail!: (e: Error) => void;
    vi.mocked(Peer.whenOpen).mockReturnValueOnce(new Promise<void>((_resolve, reject) => { fail = reject; }));
    const ws = await sharing();
    ws.receive({ t: 'peer', peerId: 'p1', via: 'scan', label: 'Win' });
    await vi.waitFor(() => { expect(ws.messages().some((m) => m.t === 'sdp')).toBe(true); });
    ws.receive({ t: 'sdp', peerId: 'p1', sdp: ANSWER });
    await vi.waitFor(() => { expect(Peer.whenOpen).toHaveBeenCalled(); });
    ws.receive({ t: 'peer-gone', peerId: 'p1' });
    fail(new Error('closed'));
    await vi.waitFor(() => { expect(State.sharePeer()).toBeNull(); });
    expect(State.shareNoPath()).toBeNull();
  });

  it('a joiner that says it found no path is named at once', async () => {
    vi.mocked(Peer.whenOpen).mockReturnValueOnce(new Promise<void>(() => {}));
    const ws = await sharing();
    ws.receive({ t: 'peer', peerId: 'p1', via: 'scan', label: 'Win' });
    await vi.waitFor(() => { expect(ws.messages().some((m) => m.t === 'sdp')).toBe(true); });
    ws.receive({ t: 'sdp', peerId: 'p1', sdp: ANSWER });
    await vi.waitFor(() => { expect(Peer.whenOpen).toHaveBeenCalled(); });
    ws.receive({ t: 'peer-gone', peerId: 'p1', reason: 'no-path' });
    expect(State.shareNoPath()).toBe('Win');
    expect(State.sharePeer()).toBeNull();
    expect(State.activeLease()).toBeNull();
  });

  it('a failure after the channel opened is not blamed on the network', async () => {
    offerWithPc({ iceConnectionState: 'failed' });
    vi.mocked(Lease.attachLend).mockReturnValueOnce(false);
    const ws = await sharing();
    ws.receive({ t: 'peer', peerId: 'p1', via: 'scan', label: 'Win' });
    await vi.waitFor(() => { expect(ws.messages().some((m) => m.t === 'sdp')).toBe(true); });
    ws.receive({ t: 'sdp', peerId: 'p1', sdp: ANSWER });
    await vi.waitFor(() => { expect(State.sharePeer()).toBeNull(); });
    expect(State.shareNoPath()).toBeNull();
  });

  it('a joiner that left before the channel opened is not blamed on the network', async () => {
    const ws = await sharing();
    ws.receive({ t: 'peer', peerId: 'p1', via: 'scan', label: 'Win' });
    await vi.waitFor(() => { expect(ws.messages().some((m) => m.t === 'sdp')).toBe(true); });
    ws.receive({ t: 'peer-gone', peerId: 'p1' });
    await Promise.resolve();
    expect(State.shareNoPath()).toBeNull();
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

  it('the local device going away while lent keeps the room open, paused', async () => {
    const ws = await sharing();
    await lent(ws);
    const serial = State.activeRecord()!.session.info.serial;
    State.activeRecord()!.session.dispose();
    expect(State.shareState()).toBe('idle');
    expect(ws.messages()).not.toContainEqual({ t: 'close' });
    expect(ws.messages().at(-1)).toEqual({ t: 'lent', on: true });
    expect(State.shareAway()?.serial).toBe(serial);
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
  it('tells the joiner at once so it does not report a network problem', async () => {
    const ws = await sharing();
    ws.receive({ t: 'peer', peerId: 'p1', via: 'scan', needsAllow: false, label: 'Win' });
    await offered(ws);
    cancelLend();
    expect(ws.messages()).toContainEqual({ t: 'deny', peerId: 'p1' });
  });

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

describe('the pending-changes prompt', () => {
  it('a room torn down during the prompt leaves sharing idle once the owner hands over', async () => {
    const ws = await sharing();
    const rec = State.activeRecord()!;
    rec.session.staging.entries.push({} as never);
    ws.receive({ t: 'peer', peerId: 'p1', via: 'scan', needsAllow: false, label: 'Win' });
    await vi.waitFor(() => { expect(State.boundary.pending).not.toBeNull(); });
    stopSharing();
    State.resolveBoundary('discard');
    // The abandoned prepare gives up without touching the device.
    expect(await vi.mocked(Lease.prepareLend).mock.results[0]!.value).toBeNull();
    expect(State.activeLease()).toBeNull();
    expect(State.shareState()).toBe('idle');
    expect(State.shareRoom()).toBeNull();
    rec.session.staging.entries.length = 0;
  });

  it('a returning joiner replacing the waiting handshake is lent the device after Hand over', async () => {
    const ws = await sharing();
    const rec = State.activeRecord()!;
    rec.session.staging.entries.push({} as never);
    ws.receive({ t: 'peer', peerId: 'p1', via: 'scan', needsAllow: false, label: 'Win' });
    await vi.waitFor(() => { expect(State.boundary.pending).not.toBeNull(); });
    ws.receive({ t: 'peer', peerId: 'p2', via: 'resume', needsAllow: false, label: 'Mac' });
    State.resolveBoundary('discard');
    await offered(ws);
    expect(ws.messages().filter((m) => m.t === 'sdp')[0]).toMatchObject({ peerId: 'p2' });
    ws.receive({ t: 'sdp', peerId: 'p2', sdp: ANSWER });
    await vi.waitFor(() => { expect(State.sharePeer()).toBeNull(); });
    expect(State.shareState()).toBe('lent');
    expect(State.activeLease()?.peerLabel).toBe('Mac');
    expect(ws.messages().filter((m) => m.t === 'deny')).toEqual([]);
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
    await bootMock('rp2350');
    const started = startSharing();
    const failure = expect(started).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10_001);
    await failure;
    expect(FakeWebSocket.last().readyState).toBe(FakeWebSocket.CLOSED);
    expect(State.shareState()).toBe('idle');
  });
});

describe('a second joiner while lent', () => {
  it('is turned away at once and the lessee keeps the device', async () => {
    const ws = await sharing();
    await lent(ws);
    ws.receive({ t: 'peer', peerId: 'p2', via: 'code', needsAllow: true, label: 'Other' });
    expect(ws.messages()).toContainEqual({ t: 'deny', peerId: 'p2' });
    expect(State.sharePeer()).toBeNull();
    expect(State.shareState()).toBe('lent');
  });

  it('tells the relay when the device is lent and when it is back', async () => {
    const ws = await sharing();
    await lent(ws);
    expect(ws.messages()).toContainEqual({ t: 'lent', on: true });
    cancelLend();
    expect(ws.messages().filter((m) => m.t === 'lent').at(-1)).toEqual({ t: 'lent', on: false });
  });
});

describe('the code and the shared device', () => {
  it('shows a used or expired code as such, and a fresh one as live again', async () => {
    const ws = await sharing();
    ws.receive({ t: 'code', code: 'ABC234', state: 'burnt' });
    expect(State.shareRoom()?.status).toBe('burnt');
    ws.receive({ t: 'rotated', code: 'XYZ234', scanKey: 'k2' });
    // A late report about the replaced code must not mark the new one.
    ws.receive({ t: 'code', code: 'ABC234', state: 'burnt' });
    expect(State.shareRoom()?.status).toBe('live');
    expect(State.shareRoom()).toEqual({ code: 'XYZ234', scanKey: 'k2', status: 'live' });
    ws.receive({ t: 'code', code: 'XYZ234', state: 'expired' });
    expect(State.shareRoom()?.status).toBe('expired');
  });

  it('tells the relay the device is lent before the offer goes out', async () => {
    const ws = await sharing();
    await lent(ws);
    const sent = ws.messages().map((m) => m.t);
    expect(sent.indexOf('lent')).toBeGreaterThan(-1);
    expect(sent.indexOf('lent')).toBeLessThan(sent.indexOf('sdp'));
  });

  it('takes the lent flag back when the lend is dropped before it attached', async () => {
    const ws = await sharing();
    ws.receive({ t: 'peer', peerId: 'p1', via: 'scan', needsAllow: false, label: 'Win' });
    await vi.waitFor(() => { expect(ws.messages()).toContainEqual({ t: 'lent', on: true }); });
    cancelLend();
    expect(ws.messages().filter((m) => m.t === 'lent').at(-1)).toEqual({ t: 'lent', on: false });
  });

  it('closes the room at once when the device died before the relay announced it', async () => {
    await bootMock('rp2350');
    const started = startSharing();
    await vi.waitFor(() => { expect(FakeWebSocket.instances).toHaveLength(1); });
    const ws = FakeWebSocket.last();
    ws.open();
    await State.activeRecord()!.session.device.close();
    ws.receive({ t: 'ready', code: 'ABC234', scanKey: 'scan' });
    await started;
    expect(State.shareState()).toBe('idle');
    expect(State.shareRoom()).toBeNull();
  });

  it('pauses the share when the device goes away while a lend is being prepared', async () => {
    const ws = await sharing();
    const rec = State.activeRecord()!;
    rec.session.staging.entries.push({} as never);
    ws.receive({ t: 'peer', peerId: 'p1', via: 'scan', needsAllow: false, label: 'Win' });
    await vi.waitFor(() => { expect(State.boundary.pending).not.toBeNull(); });
    await rec.session.device.close();
    expect(State.shareState()).toBe('idle');
    expect(State.shareAway()).not.toBeNull();
    expect(State.boundary.pending).toBeNull();
    rec.session.staging.entries.length = 0;
  });

  it('turns a joiner away when another device has become the active one', async () => {
    const ws = await sharing();
    await bootMock('rp2350');
    ws.receive({ t: 'peer', peerId: 'p1', via: 'scan', needsAllow: false, label: 'Win' });
    expect(ws.messages()).toContainEqual({ t: 'deny', peerId: 'p1' });
    expect(State.activeLease()).toBeNull();
  });
});

describe('the shared device going away', () => {
  async function goneAway(): Promise<{ ws: FakeWebSocket; serial: string }> {
    const ws = await sharing();
    const serial = State.activeRecord()!.session.info.serial;
    await State.activeRecord()!.session.device.close();
    return { ws, serial };
  }

  it('keeps the room open and reads as idle, remembering the serial', async () => {
    const { ws, serial } = await goneAway();
    expect(State.shareState()).toBe('idle');
    expect(State.shareAway()?.serial).toBe(serial);
    expect(State.shareRoom()).toBeNull();
    expect(ws.messages()).not.toContainEqual({ t: 'close' });
    expect(ws.readyState).not.toBe(FakeWebSocket.CLOSED);
  });

  it('turns arriving peers away as busy, resumed ones too, and keeps the relay marking the device lent', async () => {
    const { ws } = await goneAway();
    ws.receive({ t: 'peer', peerId: 'p1', via: 'code', label: 'Win' });
    ws.receive({ t: 'peer', peerId: 'p2', via: 'resume', label: 'Win' });
    expect(ws.messages()).toContainEqual({ t: 'busy', peerId: 'p1' });
    expect(ws.messages()).toContainEqual({ t: 'busy', peerId: 'p2' });
    expect(ws.messages().some((m) => m.t === 'deny')).toBe(false);
    expect(State.sharePeer()).toBeNull();
    expect(ws.messages().filter((m) => m.t === 'lent').at(-1)).toEqual({ t: 'lent', on: true });
  });

  it('turns away a joiner still waiting for an Allow', async () => {
    const ws = await sharing();
    ws.receive({ t: 'peer', peerId: 'p1', via: 'code', label: 'Win' });
    await State.activeRecord()!.session.device.close();
    expect(ws.messages()).toContainEqual({ t: 'busy', peerId: 'p1' });
    expect(State.sharePeer()).toBeNull();
  });

  it('a lend that comes back after the pending-changes prompt was left open works', async () => {
    const ws = await sharing();
    const rec = State.activeRecord()!;
    const serial = rec.session.info.serial;
    rec.session.staging.entries.push({} as never);
    ws.receive({ t: 'peer', peerId: 'p1', via: 'scan', needsAllow: false, label: 'Win' });
    await vi.waitFor(() => { expect(State.boundary.pending).not.toBeNull(); });
    await rec.session.device.close();
    await bootMock('rp2350', { serial });
    ws.receive({ t: 'peer', peerId: 'p2', via: 'scan', needsAllow: false, label: 'Win' });
    await offered(ws);
    ws.receive({ t: 'sdp', peerId: 'p2', sdp: ANSWER });
    await vi.waitFor(() => { expect(State.shareState()).toBe('lent'); });
  });

  it('stays paused when the device returns in the background, and resumes once it is activated', async () => {
    const ws = await sharing();
    const serial = State.activeRecord()!.session.info.serial;
    await bootMock('rp2350', { serial: 'OTHER' }, { activate: false });
    await State.activeRecord()!.session.device.close();
    expect(State.activeRecord()?.session.info.serial).toBe('OTHER');

    await bootMock('rp2350', { serial }, { activate: false });
    expect(State.shareAway()).not.toBeNull();
    expect(State.shareState()).toBe('idle');

    await DeviceService.activateSession(State.recordBySerial(serial)!.id);
    expect(State.shareAway()).toBeNull();
    expect(State.shareState()).toBe('sharing');
    expect(ws.messages().filter((m) => m.t === 'lent').at(-1)).toEqual({ t: 'lent', on: false });
  });

  it('joining a remote device closes the paused room', async () => {
    const { ws } = await goneAway();
    JoinRelay.joinByCode('ABC234');
    expect(ws.messages()).toContainEqual({ t: 'close' });
    expect(State.shareAway()).toBeNull();
    JoinRelay.leaveJoin();
  });

  it('shares again when the same device is adopted, and a returning joiner can be lent it', async () => {
    const { ws, serial } = await goneAway();
    ws.receive({ t: 'rotated', code: 'NEW234', scanKey: 'scan2' });
    await bootMock('rp2350', { serial });
    expect(State.shareAway()).toBeNull();
    expect(State.shareState()).toBe('sharing');
    expect(State.shareRoom()).toEqual({ code: 'NEW234', scanKey: 'scan2', status: 'live' });

    ws.receive({ t: 'peer', peerId: 'p3', via: 'scan', needsAllow: false, label: 'Win' });
    await offered(ws);
    ws.receive({ t: 'sdp', peerId: 'p3', sdp: ANSWER });
    await vi.waitFor(() => { expect(State.shareState()).toBe('lent'); });
  });

  it('watches the new device: losing it again pauses the share again', async () => {
    const { serial } = await goneAway();
    await bootMock('rp2350', { serial });
    await State.activeRecord()!.session.device.close();
    expect(State.shareAway()?.serial).toBe(serial);
    expect(State.shareState()).toBe('idle');
  });

  it('does not resume for a different device', async () => {
    await goneAway();
    await bootMock('rp2350', { serial: 'OTHER' });
    expect(State.shareAway()).not.toBeNull();
    expect(State.shareState()).toBe('idle');
  });

  describe('with a clock', () => {
    beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }); });
    afterEach(() => { vi.useRealTimers(); });

    it('closes the room when the device does not come back in time', async () => {
      const { ws } = await goneAway();
      vi.advanceTimersByTime(10 * 60_000 - 1);
      expect(ws.readyState).not.toBe(FakeWebSocket.CLOSED);
      vi.advanceTimersByTime(1);
      expect(ws.messages()).toContainEqual({ t: 'close' });
      expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
      expect(State.shareAway()).toBeNull();
    });

    it('a device that returns in time cancels the expiry', async () => {
      const { ws, serial } = await goneAway();
      await bootMock('rp2350', { serial });
      vi.advanceTimersByTime(11 * 60_000);
      expect(ws.readyState).not.toBe(FakeWebSocket.CLOSED);
      expect(State.shareState()).toBe('sharing');
    });
  });

  it('stop sharing closes the paused room', async () => {
    const { ws } = await goneAway();
    stopSharing();
    expect(ws.messages()).toContainEqual({ t: 'close' });
    expect(State.shareAway()).toBeNull();
  });

  it('sharing another device closes the paused room first', async () => {
    const { ws } = await goneAway();
    await bootMock('rp2350', { serial: 'OTHER' });
    const started = startSharing();
    await vi.waitFor(() => { expect(FakeWebSocket.instances).toHaveLength(2); });
    expect(ws.messages()).toContainEqual({ t: 'close' });
    expect(State.shareAway()).toBeNull();
    const next = FakeWebSocket.last();
    next.open();
    next.receive({ t: 'ready', code: 'ZZZ234', scanKey: 's' });
    expect(await started).toBe(true);
    expect(State.shareState()).toBe('sharing');
  });

  it('losing the relay while paused forgets the share', async () => {
    const { ws } = await goneAway();
    ws.drop();
    expect(State.shareAway()).toBeNull();
    expect(State.shareState()).toBe('idle');
  });
});
