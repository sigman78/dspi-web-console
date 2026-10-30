import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FakeWebSocket } from '@test/fixtures/fakeWebSocket';
import { openRoomSocket, PING_INTERVAL_MS } from './signaling';

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.reset();
  vi.stubGlobal('WebSocket', FakeWebSocket);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function connect() {
  const messages: unknown[] = [];
  const closes: boolean[] = [];
  const reasons: string[] = [];
  const socket = openRoomSocket('ws://relay/x', { t: 'host', token: 'tok' }, {
    onMessage: (m) => messages.push(m),
    onClose: (opened, reason) => { closes.push(opened); reasons.push(reason); },
  });
  return { ws: FakeWebSocket.last(), socket, messages, closes, reasons };
}

describe('openRoomSocket', () => {
  it('sends the authenticating message once connected', () => {
    const { ws } = connect();
    expect(ws.sent).toEqual([]);
    ws.open();
    expect(ws.messages()).toEqual([{ t: 'host', token: 'tok' }]);
  });

  it('pings with the exact keepalive text every interval while open', () => {
    const { ws } = connect();
    ws.open();
    vi.advanceTimersByTime(PING_INTERVAL_MS * 2);
    expect(ws.sent.filter((s) => s === '{"t":"ping"}')).toHaveLength(2);
  });

  it('stops pinging after an explicit close and does not report it', () => {
    const { ws, socket, closes } = connect();
    ws.open();
    socket.close();
    vi.advanceTimersByTime(PING_INTERVAL_MS * 3);
    expect(ws.sent.filter((s) => s === '{"t":"ping"}')).toHaveLength(0);
    expect(closes).toEqual([]);
  });

  it('delivers typed server messages, drops pongs and junk', () => {
    const { ws, messages } = connect();
    ws.open();
    ws.receive({ t: 'pong' });
    ws.receive({ t: 'nonsense' });
    ws.dispatchEvent(new MessageEvent('message', { data: 'not json' }));
    ws.receive({ t: 'rotated', code: 'ABC234', scanKey: 'k' });
    expect(messages).toEqual([{ t: 'rotated', code: 'ABC234', scanKey: 'k' }]);
  });

  it('reports whether the connection ever came up, once', () => {
    const never = connect();
    never.ws.drop();
    never.ws.dispatchEvent(new Event('error'));
    expect(never.closes).toEqual([false]);

    const up = connect();
    up.ws.open();
    up.ws.drop();
    expect(up.closes).toEqual([true]);
  });

  it('passes on the relay close reason', () => {
    const { ws, reasons } = connect();
    ws.open();
    ws.drop('replaced');
    expect(reasons).toEqual(['replaced']);
  });
});
