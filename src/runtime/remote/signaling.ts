// Room WebSocket client shared by the owner and the joining console.

import type { ClientMessage, ServerMessage } from './relayWire';

// The relay answers this exact text without waking the room.
export const PING_INTERVAL_MS = 30_000;
const PING = '{"t":"ping"}';

export interface RoomSocket {
  send(msg: ClientMessage): void;
  close(): void;
}

export interface RoomSocketHandlers {
  onMessage(msg: ServerMessage): void;
  // `opened` is false when the connection never came up; `reason` is the
  // relay's close reason. Not called after an explicit close().
  onClose(opened: boolean, reason: string): void;
}

const SERVER_TYPES = new Set(['ready', 'peer', 'joined', 'allowed', 'peer-gone', 'pong', 'denied', 'sdp', 'rotated', 'code', 'host-gone', 'error']);

function parseServer(raw: unknown): ServerMessage | null {
  if (typeof raw !== 'string') return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return null;
    const t = (data as { t?: unknown }).t;
    return typeof t === 'string' && SERVER_TYPES.has(t) ? (data as ServerMessage) : null;
  } catch {
    return null;
  }
}

// Opens `url`, sends `first` (the authenticating message) once connected and
// keeps the socket alive until it is closed from either side.
export function openRoomSocket(url: string, first: ClientMessage, handlers: RoomSocketHandlers): RoomSocket {
  const ws = new WebSocket(url);
  let opened = false;
  let ended = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const stopTimer = (): void => {
    if (timer !== null) { clearInterval(timer); timer = null; }
  };
  const end = (e: Event): void => {
    stopTimer();
    if (ended) return;
    ended = true;
    handlers.onClose(opened, (e as Partial<CloseEvent>).reason ?? '');
  };

  ws.addEventListener('open', () => {
    opened = true;
    ws.send(JSON.stringify(first));
    timer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(PING);
    }, PING_INTERVAL_MS);
  });
  ws.addEventListener('message', (e) => {
    if (ended) return;
    const msg = parseServer(e.data);
    if (msg && msg.t !== 'pong') handlers.onMessage(msg);
  });
  ws.addEventListener('close', end);
  ws.addEventListener('error', end);

  return {
    send: (msg) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
    close: () => {
      stopTimer();
      ended = true;
      ws.close();
    },
  };
}
