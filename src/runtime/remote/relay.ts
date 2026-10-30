// Where the pairing relay lives. Everything relay-related is inert while the
// build has no relay configured.

import type { CreatedRoom } from './relayWire';

// Build-time value: '/room' (same origin) in dev and in the Workers build,
// unset elsewhere.
export function remoteRelayBase(): string | null {
  const base = import.meta.env.VITE_REMOTE_RELAY;
  return base ? base.replace(/\/+$/, '') : null;
}

function socketUrl(base: string, path: string): string {
  const url = new URL(`${base}${path}`, location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

export function hostSocketUrl(base: string, roomId: string): string {
  return socketUrl(base, `/${encodeURIComponent(roomId)}/ws`);
}

export function codeSocketUrl(base: string, code: string): string {
  return socketUrl(base, `/code/${encodeURIComponent(code)}/ws`);
}

// Resume tokens are `<roomId>.<secret>`; the room id routes the socket.
export function resumeSocketUrl(base: string, token: string): string | null {
  const dot = token.indexOf('.');
  return dot > 0 ? hostSocketUrl(base, token.slice(0, dot)) : null;
}

export async function createRoom(base: string): Promise<CreatedRoom> {
  const res = await fetch(base, { method: 'POST' });
  if (res.status === 429) throw new Error('rate-limited');
  if (!res.ok) throw new Error(`relay refused the room (${res.status})`);
  return (await res.json()) as CreatedRoom;
}
