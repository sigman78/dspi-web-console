import * as Ip from './ip';
import * as Messages from './messages';
import * as Secrets from './secrets';

export { Room } from './Room';
export { CodePtr } from './CodePtr';
export { IpLimiter } from './IpLimiter';

const ATTEMPT_LIMIT = 20;
const ATTEMPT_WINDOW_MS = 60_000;
const ROOM_ID = /^[0-9a-f]{64}$/;

function originAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get('Origin');
  if (!origin || !env.ALLOWED_ORIGINS) return false;
  return env.ALLOWED_ORIGINS.split(',').some((o) => o.trim() === origin);
}

/** Browsers read signaling errors from the socket, so refusals after the upgrade are messages, not HTTP statuses. */
function refuseSocket(code: Messages.ErrorCode): Response {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  server.send(JSON.stringify({ t: 'error', code } satisfies Messages.ServerMessage));
  server.close(1000, code);
  return new Response(null, { status: 101, webSocket: client });
}

/** Null when the id is not one of this namespace's ids. */
function roomStub(env: Env, roomId: string) {
  try {
    return env.ROOM.get(env.ROOM.idFromString(roomId));
  } catch {
    return null;
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'room') return new Response('not found', { status: 404 });

    const isCreate = request.method === 'POST' && parts.length === 1;
    const isSocket = request.method === 'GET' && parts.length >= 3 && parts[parts.length - 1] === 'ws';
    if (!isCreate && !isSocket) return new Response('not found', { status: 404 });

    if (!originAllowed(request, env)) return new Response('forbidden origin', { status: 403 });

    const ip = Ip.limiterKey(request.headers.get('CF-Connecting-IP') ?? 'unknown');
    const withinLimit = await env.IP_LIMITER.getByName(ip).hit(ATTEMPT_LIMIT, ATTEMPT_WINDOW_MS);

    if (isCreate) {
      if (!withinLimit) return Response.json({ error: 'rate-limited' }, { status: 429 });
      const id = env.ROOM.newUniqueId();
      const created = await env.ROOM.get(id).create();
      return Response.json({ roomId: id.toString(), ...created });
    }

    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    if (!withinLimit) return refuseSocket('rate-limited');

    if (parts.length === 4 && parts[1] === 'code') {
      if (!Secrets.isCode(parts[2])) return refuseSocket('bad-code');
      const found = await env.CODE_PTR.getByName(parts[2]).resolve();
      if ('error' in found) return refuseSocket(found.error);
      return roomStub(env, found.roomId)?.fetch(request) ?? new Response('not found', { status: 404 });
    }

    if (parts.length === 3 && ROOM_ID.test(parts[1])) {
      return roomStub(env, parts[1])?.fetch(request) ?? new Response('not found', { status: 404 });
    }
    return new Response('not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
