import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as State from '@/state';
import { FakeWebSocket } from '@test/fixtures/fakeWebSocket';
import { joinRemote } from './join';
import * as Manual from './manualSignaling';
import * as Peer from './peer';
import * as JoinRelay from './joinRelay';
import type { DspDevice } from '@/device/DspDevice';

vi.mock('./join', () => ({ joinRemote: vi.fn(async () => 1) }));
vi.mock('./manualSignaling', () => ({ createAnswer: vi.fn() }));
vi.mock('./peer', () => ({ wrapDataChannel: vi.fn(), whenOpen: vi.fn(async () => 1) }));

const STORE_KEY = 'dspi-console-web/remote/v1';
const TOKEN = 'a'.repeat(64) + '.secret';

function storedResume(): string | undefined {
  const raw = localStorage.getItem(STORE_KEY);
  return raw ? (JSON.parse(raw) as { resume?: string }).resume : undefined;
}

beforeEach(() => {
  State.resetRemoteState();
  FakeWebSocket.reset();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubEnv('VITE_REMOTE_RELAY', '/room');
});
afterEach(() => {
  JoinRelay.leaveJoin();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function connected(code = 'ABC234'): FakeWebSocket {
  JoinRelay.joinByCode(code);
  const ws = FakeWebSocket.last();
  ws.open();
  return ws;
}

describe('normalizeCode', () => {
  it('uppercases and ignores spaces and dashes', () => {
    expect(JoinRelay.normalizeCode(' abc-234 ')).toBe('ABC234');
  });

  it('rejects symbols outside the alphabet and wrong lengths', () => {
    expect(JoinRelay.normalizeCode('ABC0O1')).toBeNull();
    expect(JoinRelay.normalizeCode('ABC23')).toBeNull();
    expect(JoinRelay.normalizeCode('ABC2345')).toBeNull();
  });
});

describe('with the relay off', () => {
  beforeEach(() => { vi.stubEnv('VITE_REMOTE_RELAY', ''); });

  it('joins nothing and ignores ?join=', () => {
    JoinRelay.joinByCode('ABC234');
    JoinRelay.joinWithResume();
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(State.joinState().phase).toBe('idle');
    expect(JoinRelay.pendingJoinFromUrl('?join=ABC234')).toBeNull();
  });
});

describe('pendingJoinFromUrl', () => {
  it('reads the code and the scan key', () => {
    expect(JoinRelay.pendingJoinFromUrl('?join=abc-234&k=KEY')).toEqual({ code: 'ABC234', scanKey: 'KEY' });
    expect(JoinRelay.pendingJoinFromUrl('?join=ABC234')).toEqual({ code: 'ABC234', scanKey: null });
    expect(JoinRelay.pendingJoinFromUrl('?join=nope')).toBeNull();
  });
});

describe('joining by code', () => {
  it('passes the scan key along', () => {
    JoinRelay.joinByCode('ABC234', 'KEY');
    const ws = FakeWebSocket.last();
    ws.open();
    expect(ws.messages()[0]).toMatchObject({ t: 'join', code: 'ABC234', scanKey: 'KEY' });
  });

  it('refuses a malformed code without touching the relay', () => {
    JoinRelay.joinByCode('ABC0O1');
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(State.joinState()).toEqual({ phase: 'failed', reason: 'bad-code' });
  });

  it('asks for the room behind the code with a synthesized label', () => {
    const ws = connected();
    expect(ws.url).toMatch(/\/room\/code\/ABC234\/ws$/);
    const [join] = ws.messages();
    expect(join).toMatchObject({ t: 'join', code: 'ABC234' });
    expect(join.label).toMatch(/ · .* · /);
    expect(join.scanKey).toBeUndefined();
  });

  it('waits for the owner, keeps the token until allowed, then waits for the offer', () => {
    const ws = connected();
    ws.receive({ t: 'joined', needsAllow: true });
    expect(State.joinState().phase).toBe('waiting-allow');
    expect(storedResume()).toBeUndefined();

    ws.receive({ t: 'allowed', resumeToken: TOKEN });
    expect(State.joinState().phase).toBe('allowed');
    expect(storedResume()).toBe(TOKEN);
  });

  it('skips the wait and stores the token when no Allow is needed', () => {
    const ws = connected();
    ws.receive({ t: 'joined', needsAllow: false, resumeToken: TOKEN });
    expect(State.joinState().phase).toBe('allowed');
    expect(storedResume()).toBe(TOKEN);
  });

  it('answers the offer, leaves the relay and joins over the channel', async () => {
    const dc = {} as RTCDataChannel;
    const channel = { id: 'tunnel', onClose: vi.fn() };
    vi.mocked(Manual.createAnswer).mockResolvedValue({
      pc: { close: vi.fn() } as unknown as RTCPeerConnection,
      channel: Promise.resolve(dc),
      answer: JSON.stringify({ type: 'answer', sdp: 'ans' }),
    });
    vi.mocked(Peer.wrapDataChannel).mockReturnValue(channel as never);

    const ws = connected();
    ws.receive({ t: 'joined', needsAllow: false, resumeToken: TOKEN });
    ws.receive({ t: 'sdp', sdp: { type: 'offer', sdp: 'off' } });

    await vi.waitFor(() => { expect(State.joinState().phase).toBe('joined'); });
    expect(ws.messages()).toContainEqual({ t: 'sdp', sdp: { type: 'answer', sdp: 'ans' } });
    expect(joinRemote).toHaveBeenCalledWith(channel, expect.any(String), {});
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
  });

  it('reports a failed adoption', async () => {
    vi.mocked(Manual.createAnswer).mockResolvedValue({
      pc: { close: vi.fn() } as unknown as RTCPeerConnection,
      channel: Promise.resolve({} as RTCDataChannel),
      answer: JSON.stringify({ type: 'answer', sdp: 'ans' }),
    });
    vi.mocked(joinRemote).mockRejectedValueOnce(new Error('adoption failed'));
    const ws = connected();
    ws.receive({ t: 'joined', needsAllow: false, resumeToken: TOKEN });
    ws.receive({ t: 'sdp', sdp: { type: 'offer', sdp: 'off' } });
    await vi.waitFor(() => { expect(State.joinState()).toEqual({ phase: 'failed', reason: 'failed' }); });
  });

  it('ignores an offer that arrives before the owner allowed', () => {
    const ws = connected();
    ws.receive({ t: 'joined', needsAllow: true });
    ws.receive({ t: 'sdp', sdp: { type: 'offer', sdp: 'off' } });
    expect(Manual.createAnswer).not.toHaveBeenCalled();
  });
});

function offerAnswered(extra: Partial<Awaited<ReturnType<typeof Manual.createAnswer>>> = {}) {
  const pc = { close: vi.fn() };
  vi.mocked(Manual.createAnswer).mockResolvedValue({
    pc: pc as unknown as RTCPeerConnection,
    channel: Promise.resolve({} as RTCDataChannel),
    answer: JSON.stringify({ type: 'answer', sdp: 'ans' }),
    ...extra,
  });
  return pc;
}

describe('after joining', () => {
  it('reports the owner gone when the tunnel closes', async () => {
    offerAnswered();
    let closed = (): void => {};
    vi.mocked(Peer.wrapDataChannel).mockReturnValue({ onClose: (l: () => void) => { closed = l; } } as never);
    const ws = connected();
    ws.receive({ t: 'joined', needsAllow: false, resumeToken: TOKEN });
    ws.receive({ t: 'sdp', sdp: { type: 'offer', sdp: 'off' } });
    await vi.waitFor(() => { expect(State.joinState().phase).toBe('joined'); });

    closed();
    expect(State.joinState()).toEqual({ phase: 'failed', reason: 'host-gone' });
  });

  it('a superseded attempt cannot report joined', async () => {
    offerAnswered();
    let finish = (): void => {};
    vi.mocked(joinRemote).mockImplementationOnce(() => new Promise<number>((resolve) => { finish = () => { resolve(1); }; }));
    vi.mocked(Peer.wrapDataChannel).mockReturnValue({ onClose: vi.fn() } as never);
    const ws = connected();
    ws.receive({ t: 'joined', needsAllow: false, resumeToken: TOKEN });
    ws.receive({ t: 'sdp', sdp: { type: 'offer', sdp: 'off' } });
    await vi.waitFor(() => { expect(joinRemote).toHaveBeenCalled(); });

    JoinRelay.leaveJoin();
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(State.joinState().phase).toBe('idle');
  });
});

describe('abandoning a handshake', () => {
  it('closes the peer connection', async () => {
    const pc = offerAnswered({ channel: new Promise<RTCDataChannel>(() => {}) });
    const ws = connected();
    ws.receive({ t: 'joined', needsAllow: false, resumeToken: TOKEN });
    ws.receive({ t: 'sdp', sdp: { type: 'offer', sdp: 'off' } });
    await vi.waitFor(() => { expect(Manual.createAnswer).toHaveBeenCalled(); });
    await Promise.resolve();

    JoinRelay.leaveJoin();
    expect(pc.close).toHaveBeenCalled();
    expect(State.joinState().phase).toBe('idle');
  });

  it('fails when the channel never opens', async () => {
    vi.useFakeTimers();
    try {
      const pc = offerAnswered({ channel: new Promise<RTCDataChannel>(() => {}) });
      const ws = connected();
      ws.receive({ t: 'joined', needsAllow: false, resumeToken: TOKEN });
      ws.receive({ t: 'sdp', sdp: { type: 'offer', sdp: 'off' } });
      await vi.advanceTimersByTimeAsync(31_000);
      expect(State.joinState()).toEqual({ phase: 'failed', reason: 'no-path' });
      expect(ws.messages()).toContainEqual({ t: 'bye', reason: 'no-path' });
      expect(pc.close).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports no path when the peer connection fails before the channel opens', async () => {
    offerAnswered({ channel: Promise.reject(new Error('peer connection failed before the tunnel opened')) });
    const ws = connected();
    ws.receive({ t: 'joined', needsAllow: false, resumeToken: TOKEN });
    ws.receive({ t: 'sdp', sdp: { type: 'offer', sdp: 'off' } });
    await vi.waitFor(() => { expect(State.joinState()).toEqual({ phase: 'failed', reason: 'no-path' }); });
  });

  it('a failure before the answer went out is a plain failure, not a network one', async () => {
    vi.mocked(Manual.createAnswer).mockRejectedValue(new Error('bad offer'));
    const ws = connected();
    ws.receive({ t: 'joined', needsAllow: false, resumeToken: TOKEN });
    ws.receive({ t: 'sdp', sdp: { type: 'offer', sdp: 'off' } });
    await vi.waitFor(() => { expect(State.joinState()).toEqual({ phase: 'failed', reason: 'failed' }); });
  });
});

describe('failures', () => {
  it('names why the relay closed the socket', () => {
    const ws = connected();
    ws.drop('replaced');
    expect(State.joinState()).toEqual({ phase: 'failed', reason: 'replaced' });

    const ws2 = connected();
    ws2.drop('protocol');
    expect(State.joinState()).toEqual({ phase: 'failed', reason: 'violation' });
  });

  it('keeps the token when the owner refuses a join that needed no Allow', () => {
    const ws = connected();
    ws.receive({ t: 'joined', needsAllow: false, resumeToken: TOKEN });
    ws.receive({ t: 'denied' });
    expect(State.joinState()).toEqual({ phase: 'failed', reason: 'denied' });
    expect(storedResume()).toBe(TOKEN);
  });

  it('surfaces the relay refusal as the reason', () => {
    const ws = connected();
    ws.receive({ t: 'error', code: 'burnt' });
    expect(State.joinState()).toEqual({ phase: 'failed', reason: 'burnt' });
  });

  it('a denied join clears the token and says so', () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ resume: TOKEN }));
    const ws = connected();
    ws.receive({ t: 'joined', needsAllow: true });
    ws.receive({ t: 'denied' });
    expect(State.joinState()).toEqual({ phase: 'failed', reason: 'denied' });
    expect(storedResume()).toBeUndefined();
  });

  it('a mistyped code does not forget a good stored token', () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ resume: TOKEN }));
    const ws = connected();
    ws.receive({ t: 'error', code: 'bad-code' });
    expect(storedResume()).toBe(TOKEN);
  });

  it('the owner leaving ends the join', () => {
    const ws = connected();
    ws.receive({ t: 'joined', needsAllow: true });
    ws.receive({ t: 'host-gone' });
    expect(State.joinState()).toEqual({ phase: 'failed', reason: 'host-gone' });
  });

  it('an unreachable relay is reported as such', () => {
    JoinRelay.joinByCode('ABC234');
    FakeWebSocket.last().drop();
    expect(State.joinState()).toEqual({ phase: 'failed', reason: 'unreachable' });
  });

  it('gives up when no offer comes', () => {
    vi.useFakeTimers();
    try {
      const ws = connected();
      ws.receive({ t: 'joined', needsAllow: false, resumeToken: TOKEN });
      vi.advanceTimersByTime(61_000);
      expect(State.joinState()).toEqual({ phase: 'failed', reason: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('resuming', () => {
  it('has nothing to resume without a token', () => {
    JoinRelay.joinWithResume();
    expect(State.joinState()).toEqual({ phase: 'failed', reason: 'no-token' });
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('goes straight to the stored room with the token', () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ resume: TOKEN }));
    JoinRelay.joinWithResume();
    const ws = FakeWebSocket.last();
    ws.open();
    expect(ws.url).toMatch(new RegExp(`/room/${'a'.repeat(64)}/ws$`));
    expect(ws.messages()[0]).toMatchObject({ t: 'join', resume: TOKEN });
  });

  it.each(['bad-code', 'no-host'] as const)('forgets a token the relay refuses (%s)', (code) => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ resume: TOKEN }));
    JoinRelay.joinWithResume();
    FakeWebSocket.last().open();
    FakeWebSocket.last().receive({ t: 'error', code });
    expect(State.joinState()).toEqual({ phase: 'failed', reason: code });
    expect(storedResume()).toBeUndefined();
  });

  it('keeps the token when the owner is merely busy', () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ resume: TOKEN }));
    JoinRelay.joinWithResume();
    FakeWebSocket.last().open();
    FakeWebSocket.last().receive({ t: 'error', code: 'busy' });
    expect(storedResume()).toBe(TOKEN);
  });
});

describe('coming back after a reload', () => {
  const REJOIN_KEY = 'dspi-console-web/remote/rejoin';
  const storedRejoin = (): boolean => sessionStorage.getItem(REJOIN_KEY) !== null;
  const setRejoin = (resume = TOKEN, name = 'SER'): void => { sessionStorage.setItem(REJOIN_KEY, JSON.stringify({ resume, name })); };
  const storeResume = (): void => { localStorage.setItem(STORE_KEY, JSON.stringify({ resume: TOKEN })); };

  // Joins a device whose record exists, so the session counts as live.
  async function joined(): Promise<() => void> {
    const id = State.mintConnId();
    State.dispatch({ t: 'synced', id, session: State.makeReadySession({ info: { serial: 'S' }, hardware: {} } as unknown as DspDevice) });
    vi.mocked(joinRemote).mockResolvedValueOnce(id);
    offerAnswered();
    let closed = (): void => {};
    vi.mocked(Peer.wrapDataChannel).mockReturnValue({ onClose: (l: () => void) => { closed = l; } } as never);
    const ws = connected();
    ws.receive({ t: 'joined', needsAllow: false, resumeToken: TOKEN });
    ws.receive({ t: 'sdp', sdp: { type: 'offer', sdp: 'off' } });
    await vi.waitFor(() => { expect(State.joinState().phase).toBe('joined'); });
    return () => { closed(); };
  }

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    State.resetAppState();
    State.clearNotices();
  });
  afterEach(() => {
    window.dispatchEvent(new Event('pageshow'));
    State.resetAppState();
  });

  it('is wanted once a device is joined, and not before', async () => {
    const ws = connected();
    ws.receive({ t: 'joined', needsAllow: false, resumeToken: TOKEN });
    expect(storedRejoin()).toBe(false);
    ws.close();
    await joined();
    expect(storedRejoin()).toBe(true);
  });

  it('ends when the host ends the session', async () => {
    const hostEnds = await joined();
    hostEnds();
    expect(storedRejoin()).toBe(false);
  });

  it('does not end when the tunnel closes because the page is unloading', async () => {
    const tunnelCloses = await joined();
    window.dispatchEvent(new Event('pagehide'));
    tunnelCloses();
    expect(storedRejoin()).toBe(true);
  });

  it('ends when the user cancels a reconnect in progress', () => {
    storeResume();
    setRejoin();
    expect(JoinRelay.rejoinOnBoot()).toBe(true);
    JoinRelay.leaveJoin();
    expect(storedRejoin()).toBe(false);
  });

  it('ends when the reconnect fails, but survives the reconnect starting', () => {
    storeResume();
    setRejoin();
    JoinRelay.rejoinOnBoot();
    expect(storedRejoin()).toBe(true);
    FakeWebSocket.last().open();
    FakeWebSocket.last().receive({ t: 'error', code: 'busy' });
    expect(State.joinState()).toEqual({ phase: 'failed', reason: 'busy' });
    expect(storedRejoin()).toBe(false);
  });

  it('the first device ending is noticed even after a later attempt began', async () => {
    const hostEnds = await joined();
    connected('XYZ234');
    hostEnds();
    expect(storedRejoin()).toBe(false);
    expect(State.joinState().phase).toBe('connecting');
  });

  it('cancelling a later attempt keeps the wish to come back to the joined device', async () => {
    await joined();
    connected('XYZ234');
    JoinRelay.leaveJoin();
    expect(storedRejoin()).toBe(true);
  });

  describe('at boot', () => {
    it('resumes when the flag and a token are both stored, without taking over the active device', async () => {
      storeResume();
      setRejoin();
      offerAnswered();
      vi.mocked(Peer.wrapDataChannel).mockReturnValue({ onClose: vi.fn() } as never);
      expect(JoinRelay.rejoinOnBoot()).toBe(true);
      const ws = FakeWebSocket.last();
      ws.open();
      expect(ws.messages()[0]).toMatchObject({ t: 'join', resume: TOKEN });
      expect(State.notices.list.some((n) => n.kind === 'info')).toBe(true);

      ws.receive({ t: 'joined', needsAllow: false, resumeToken: TOKEN });
      ws.receive({ t: 'sdp', sdp: { type: 'offer', sdp: 'off' } });
      await vi.waitFor(() => { expect(joinRemote).toHaveBeenCalledWith(expect.anything(), expect.any(String), { activate: false }); });
    });

    it('a user-started join does activate the device', async () => {
      offerAnswered();
      vi.mocked(Peer.wrapDataChannel).mockReturnValue({ onClose: vi.fn() } as never);
      const ws = connected();
      ws.receive({ t: 'joined', needsAllow: false, resumeToken: TOKEN });
      ws.receive({ t: 'sdp', sdp: { type: 'offer', sdp: 'off' } });
      await vi.waitFor(() => { expect(joinRemote).toHaveBeenCalledWith(expect.anything(), expect.any(String), {}); });
    });

    it('says so when the reconnect fails', () => {
      storeResume();
      setRejoin();
      JoinRelay.rejoinOnBoot();
      FakeWebSocket.last().open();
      FakeWebSocket.last().receive({ t: 'error', code: 'no-host' });
      expect(State.notices.list.some((n) => n.kind === 'warn')).toBe(true);
    });

    it('gives up when the host does not answer the Allow prompt', () => {
      vi.useFakeTimers();
      try {
        storeResume();
        setRejoin();
        JoinRelay.rejoinOnBoot();
        const ws = FakeWebSocket.last();
        ws.open();
        ws.receive({ t: 'joined', needsAllow: true });
        vi.advanceTimersByTime(61_000);
        expect(State.joinState()).toEqual({ phase: 'failed', reason: 'timeout' });
        expect(storedRejoin()).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does nothing without a joined session to return to', () => {
      storeResume();
      expect(JoinRelay.rejoinOnBoot()).toBe(false);
      expect(FakeWebSocket.instances).toHaveLength(0);
    });

    it('resumes with the token of the joined session, not whatever attempt wrote the shared store last', () => {
      const first = 'a'.repeat(64) + '.first';
      const second = 'b'.repeat(64) + '.second';
      localStorage.setItem(STORE_KEY, JSON.stringify({ resume: second }));
      setRejoin(first, 'SER1');
      expect(JoinRelay.rejoinOnBoot()).toBe(true);
      const ws = FakeWebSocket.last();
      ws.open();
      expect(ws.messages()[0]).toMatchObject({ t: 'join', resume: first });
      expect(ws.url).toContain('a'.repeat(64));
    });

    it('a later attempt that never completes does not change what a reload resumes', async () => {
      await joined();
      const joinedToken = JSON.parse(sessionStorage.getItem(REJOIN_KEY)!).resume as string;
      const ws = connected('XYZ234');
      ws.receive({ t: 'joined', needsAllow: false, resumeToken: 'c'.repeat(64) + '.other' });
      JoinRelay.leaveJoin();
      expect(JSON.parse(sessionStorage.getItem(REJOIN_KEY)!).resume).toBe(joinedToken);
    });

    it('ignores a flag that only another tab set', () => {
      storeResume();
      localStorage.setItem(REJOIN_KEY, JSON.stringify({ resume: TOKEN }));
      expect(JoinRelay.rejoinOnBoot()).toBe(false);
    });

    it('leaves a ?join= link to the join popover', () => {
      storeResume();
      setRejoin();
      State.setPendingJoin({ code: 'ABC234', scanKey: null });
      expect(JoinRelay.rejoinOnBoot()).toBe(false);
      expect(FakeWebSocket.instances).toHaveLength(0);
    });

    it('does nothing when the build has no relay', () => {
      vi.stubEnv('VITE_REMOTE_RELAY', '');
      storeResume();
      setRejoin();
      expect(JoinRelay.rejoinOnBoot()).toBe(false);
    });
  });
});

describe('without storage', () => {
  it('still joins', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const ws = connected();
    ws.receive({ t: 'joined', needsAllow: false, resumeToken: TOKEN });
    expect(State.joinState().phase).toBe('allowed');
    vi.restoreAllMocks();
  });
});

describe('takePendingJoin', () => {
  it('hands over the link once and removes join and k from the address bar', () => {
    history.replaceState(null, '', '/app/?join=ABC234&k=KEY&mock#x');
    State.setPendingJoin({ code: 'ABC234', scanKey: 'KEY' });

    expect(JoinRelay.takePendingJoin()).toEqual({ code: 'ABC234', scanKey: 'KEY' });
    expect(JoinRelay.takePendingJoin()).toBeNull();
    expect(location.pathname + location.search + location.hash).toBe('/app/?mock#x');
  });
});

describe('the stored resume target', () => {
  function storedName(): string | undefined {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as { resumeName?: string }).resumeName : undefined;
  }

  it('remembers the joined device serial and forgets it when a new token is issued', async () => {
    const device = { info: { serial: 'SER123' }, hardware: { name: 'RP2350' } } as unknown as DspDevice;
    const id = State.mintConnId();
    State.dispatch({ t: 'synced', id, session: State.makeReadySession(device) });
    vi.mocked(joinRemote).mockResolvedValueOnce(id);
    vi.mocked(Manual.createAnswer).mockResolvedValue({
      pc: { close: vi.fn() } as unknown as RTCPeerConnection,
      channel: Promise.resolve({} as RTCDataChannel),
      answer: JSON.stringify({ type: 'answer', sdp: 'ans' }),
    });
    vi.mocked(Peer.wrapDataChannel).mockReturnValue({ onClose: vi.fn() } as never);

    const ws = connected();
    ws.receive({ t: 'joined', needsAllow: false, resumeToken: TOKEN });
    ws.receive({ t: 'sdp', sdp: { type: 'offer', sdp: 'off' } });
    await vi.waitFor(() => { expect(State.joinState().phase).toBe('joined'); });
    expect(storedName()).toBe('SER123');
    expect(JoinRelay.resumeTarget()).toBe('SER123');

    JoinRelay.leaveJoin();
    const next = connected('XYZ234');
    next.receive({ t: 'joined', needsAllow: false, resumeToken: 'b'.repeat(64) + '.other' });
    expect(storedName()).toBeUndefined();
    expect(JoinRelay.resumeTarget()).toBe('last console');
    State.resetAppState();
  });
});
