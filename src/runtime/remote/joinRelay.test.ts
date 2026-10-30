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
    expect(joinRemote).toHaveBeenCalledWith(channel, expect.any(String));
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
      expect(State.joinState()).toEqual({ phase: 'failed', reason: 'failed' });
      expect(pc.close).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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
