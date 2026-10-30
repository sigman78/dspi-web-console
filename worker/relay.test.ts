import { env, exports } from 'cloudflare:workers';
import { evictDurableObject, runDurableObjectAlarm } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const ORIGIN = 'https://console.test';

let ipCounter = 0;
/** A fresh client address per test keeps the per-IP limiter out of unrelated tests. */
function newIp(): string {
  ipCounter += 1;
  return `10.0.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

interface Created {
  roomId: string;
  code: string;
  scanKey: string;
  hostToken: string;
}

type Msg = Record<string, any>;

class Peer {
  readonly inbox: Msg[] = [];
  readonly closed: Promise<number>;
  #waiters: ((m: Msg) => void)[] = [];

  constructor(readonly ws: WebSocket) {
    ws.accept();
    this.closed = new Promise((resolve) => ws.addEventListener('close', (e) => resolve(e.code)));
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data as string) as Msg;
      const waiter = this.#waiters.shift();
      if (waiter) waiter(m);
      else this.inbox.push(m);
    });
  }

  next(): Promise<Msg> {
    const queued = this.inbox.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => this.#waiters.push(resolve));
  }

  /** Next message of the given type; earlier ones of other types are skipped. */
  async nextOf(t: string): Promise<Msg> {
    for (;;) {
      const m = await this.next();
      if (m.t === t) return m;
    }
  }

  send(msg: unknown): void {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
}

async function upgrade(path: string, ip: string, origin = ORIGIN): Promise<Response> {
  return exports.default.fetch(`https://relay.test${path}`, {
    headers: { Upgrade: 'websocket', Origin: origin, 'CF-Connecting-IP': ip },
  });
}

async function connect(path: string, ip: string): Promise<Peer> {
  const res = await upgrade(path, ip);
  expect(res.status).toBe(101);
  return new Peer(res.webSocket!);
}

async function createRoom(ip: string): Promise<Created> {
  const res = await exports.default.fetch('https://relay.test/room', {
    method: 'POST',
    headers: { Origin: ORIGIN, 'CF-Connecting-IP': ip },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Created;
}

async function openHost(ip: string) {
  const room = await createRoom(ip);
  const host = await connect(`/room/${room.roomId}/ws`, ip);
  host.send({ t: 'host', token: room.hostToken });
  const ready = await host.next();
  return { room, host, ready };
}

async function joinByCode(code: string, ip: string, extra: Msg = {}): Promise<{ guest: Peer; first: Msg }> {
  const guest = await connect(`/room/code/${code}/ws`, ip);
  guest.send({ t: 'join', code, label: 'Laptop', ...extra });
  return { guest, first: await guest.next() };
}

async function joinByResume(room: Created, token: string, ip: string): Promise<{ guest: Peer; first: Msg }> {
  const guest = await connect(`/room/${room.roomId}/ws`, ip);
  guest.send({ t: 'join', resume: token });
  return { guest, first: await guest.next() };
}

/** Room with an allowed guest; returns the pieces tests need to keep going. */
async function lentRoom(ip: string) {
  const { room, host } = await openHost(ip);
  const { guest } = await joinByCode(room.code, ip);
  const peer = await host.nextOf('peer');
  await host.nextOf('code');
  host.send({ t: 'allow', peerId: peer.peerId });
  const allowed = await guest.next();
  expect(allowed.t).toBe('allowed');
  return { room, host, guest, peerId: peer.peerId as string, resumeToken: allowed.resumeToken as string };
}

describe('code lifecycle', () => {
  it('announces the code on the host socket and resolves it to one guest', async () => {
    const ip = newIp();
    const { room, host, ready } = await openHost(ip);
    expect(ready).toEqual({ t: 'ready', code: room.code, scanKey: room.scanKey });

    const { first } = await joinByCode(room.code, ip, { label: 'Windows · Chrome · amber-fox' });
    expect(first).toEqual({ t: 'joined', needsAllow: true });
    expect(await host.next()).toMatchObject({ t: 'peer', via: 'code', needsAllow: true, label: 'Windows · Chrome · amber-fox' });
  });

  it('burns the code on the first successful join', async () => {
    const ip = newIp();
    const { room } = await openHost(ip);
    await joinByCode(room.code, ip);
    const again = await joinByCode(room.code, ip);
    expect(again.first).toEqual({ t: 'error', code: 'burnt' });
  });

  it('stops resolving the code once the expiry alarm has run', async () => {
    const ip = newIp();
    const { room } = await openHost(ip);
    const stub = env.ROOM.get(env.ROOM.idFromString(room.roomId));
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const late = await joinByCode(room.code, ip);
    expect(late.first).toEqual({ t: 'error', code: 'expired' });
  });

  it('rejects an unknown code', async () => {
    const guest = await connect('/room/code/ZZZZZZ/ws', newIp());
    expect(await guest.next()).toEqual({ t: 'error', code: 'bad-code' });
  });

  it('invalidates the old code on rotate and honours the new one', async () => {
    const ip = newIp();
    const { room, host } = await openHost(ip);
    host.send({ t: 'rotate' });
    const rotated = await host.next();
    expect(rotated.t).toBe('rotated');
    expect(rotated.code).not.toBe(room.code);

    const old = await joinByCode(room.code, ip);
    expect(old.first.t).toBe('error');
    const fresh = await joinByCode(rotated.code, ip);
    expect(fresh.first.t).toBe('joined');
  });

  it('lets a scan key join without Allow, and refuses a wrong key', async () => {
    const ip = newIp();
    const { room } = await openHost(ip);
    const wrong = await joinByCode(room.code, ip, { scanKey: 'x'.repeat(22) });
    expect(wrong.first).toEqual({ t: 'error', code: 'bad-code' });
    const ok = await joinByCode(room.code, ip, { scanKey: room.scanKey });
    expect(ok.first).toMatchObject({ t: 'joined', needsAllow: false });
  });
});

describe('single guest', () => {
  it('refuses a second guest while one holds the room', async () => {
    const ip = newIp();
    const { room, host } = await openHost(ip);
    await joinByCode(room.code, ip);
    host.send({ t: 'rotate' });
    const { code } = await host.nextOf('rotated');
    const second = await joinByCode(code, ip);
    expect(second.first).toEqual({ t: 'error', code: 'busy' });
  });
});

describe('resume', () => {
  it('needs no Allow after a plain guest drop', async () => {
    const ip = newIp();
    const { room, guest, resumeToken } = await lentRoom(ip);
    guest.ws.close(1000);
    const back = await joinByResume(room, resumeToken, ip);
    expect(back.first).toMatchObject({ t: 'joined', needsAllow: false });
  });

  it('needs Allow after the host reclaimed, and Allow clears that', async () => {
    const ip = newIp();
    const { room, host, guest, resumeToken } = await lentRoom(ip);
    host.send({ t: 'reclaim' });
    guest.ws.close(1000);

    const first = await joinByResume(room, resumeToken, ip);
    expect(first.first).toMatchObject({ t: 'joined', needsAllow: true });
    const peer = await host.nextOf('peer');
    host.send({ t: 'allow', peerId: peer.peerId });
    expect((await first.guest.next()).t).toBe('allowed');
    first.guest.ws.close(1000);

    const second = await joinByResume(room, resumeToken, ip);
    expect(second.first).toMatchObject({ t: 'joined', needsAllow: false });
  });

  it('rejects a wrong secret', async () => {
    const ip = newIp();
    const { room } = await lentRoom(ip);
    const bad = await joinByResume(room, `${room.roomId}.${'a'.repeat(22)}`, ip);
    expect(bad.first).toEqual({ t: 'error', code: 'bad-code' });
  });

  it('is refused after the host socket closes, and guests are told', async () => {
    const ip = newIp();
    const { room, host, guest, resumeToken } = await lentRoom(ip);
    host.ws.close(1000);
    expect(await guest.next()).toEqual({ t: 'host-gone' });
    await guest.closed;

    const back = await joinByResume(room, resumeToken, ip);
    expect(back.first).toEqual({ t: 'error', code: 'no-host' });
    const byCode = await joinByCode(room.code, ip);
    expect(byCode.first.t).toBe('error');
  });

  it('keeps the room, the lease and the sockets across a Durable Object eviction', async () => {
    const ip = newIp();
    const { room, host, guest, peerId, resumeToken } = await lentRoom(ip);
    await evictDurableObject(env.ROOM.get(env.ROOM.idFromString(room.roomId)));

    const offer = { type: 'offer', sdp: 'v=0 offer' };
    host.send({ t: 'sdp', sdp: offer, peerId });
    expect(await guest.next()).toEqual({ t: 'sdp', sdp: offer });
    guest.ws.close(1000);
    const back = await joinByResume(room, resumeToken, ip);
    expect(back.first).toMatchObject({ t: 'joined', needsAllow: false });
  });

  it('ends the room when the host sends close', async () => {
    const ip = newIp();
    const { host, guest } = await lentRoom(ip);
    host.send({ t: 'close' });
    expect(await guest.next()).toEqual({ t: 'host-gone' });
  });
});

describe('signaling relay', () => {
  it('relays sdp in both directions once allowed', async () => {
    const ip = newIp();
    const { host, guest, peerId } = await lentRoom(ip);
    const offer = { type: 'offer', sdp: 'v=0 offer' };
    const answer = { type: 'answer', sdp: 'v=0 answer' };
    host.send({ t: 'sdp', sdp: offer, peerId });
    expect(await guest.next()).toEqual({ t: 'sdp', sdp: offer });
    guest.send({ t: 'sdp', sdp: answer });
    expect(await host.next()).toEqual({ t: 'sdp', sdp: answer, peerId });
  });

  it('closes a guest that sends sdp before the host allowed it', async () => {
    const ip = newIp();
    const { room, host } = await openHost(ip);
    const { guest } = await joinByCode(room.code, ip);
    await host.next();
    guest.send({ t: 'sdp', sdp: { type: 'answer', sdp: 'v=0' } });
    expect(await guest.closed).toBe(1008);
  });

  it('closes the socket on malformed messages', async () => {
    const ip = newIp();
    const { room } = await openHost(ip);
    for (const bad of ['not json', JSON.stringify({ t: 'nope' }), JSON.stringify({ t: 'join', code: 'abc' })]) {
      const guest = await connect(`/room/${room.roomId}/ws`, ip);
      guest.send(bad);
      expect(await guest.closed).toBe(1008);
    }
  });

  it('treats an oversized but otherwise valid message as a violation', async () => {
    const ip = newIp();
    const { room, host } = await openHost(ip);
    const { guest } = await joinByCode(room.code, ip);
    const peer = await host.next();
    host.send({ t: 'allow', peerId: peer.peerId, pad: 'x'.repeat(40_000) });
    expect(await guest.next()).toEqual({ t: 'host-gone' });
  });

  it('closes a host socket that presents the wrong token', async () => {
    const ip = newIp();
    const room = await createRoom(ip);
    const host = await connect(`/room/${room.roomId}/ws`, ip);
    host.send({ t: 'host', token: 'b'.repeat(22) });
    expect(await host.closed).toBe(1008);
  });
});

describe('edge protection', () => {
  it('answers 403 to a foreign Origin on create and on upgrade', async () => {
    const ip = newIp();
    const post = await exports.default.fetch('https://relay.test/room', {
      method: 'POST',
      headers: { Origin: 'https://evil.test', 'CF-Connecting-IP': ip },
    });
    expect(post.status).toBe(403);
    expect((await upgrade('/room/code/ABCDEF/ws', ip, 'https://evil.test')).status).toBe(403);
    expect((await upgrade('/room/code/ABCDEF/ws', ip, 'https://other.test')).status).toBe(101);
  });

  it('answers 403 when no Origin is sent', async () => {
    const res = await exports.default.fetch('https://relay.test/room', { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('refuses the 21st attempt within a minute from one address', async () => {
    const ip = newIp();
    for (let i = 0; i < 20; i++) {
      const guest = await connect('/room/code/ABCDEF/ws', ip);
      expect(await guest.next()).toEqual({ t: 'error', code: 'bad-code' });
    }
    const limited = await connect('/room/code/ABCDEF/ws', ip);
    expect(await limited.next()).toEqual({ t: 'error', code: 'rate-limited' });

    const other = await connect('/room/code/ABCDEF/ws', newIp());
    expect(await other.next()).toEqual({ t: 'error', code: 'bad-code' });
  });
});

describe('allow gate', () => {
  it('withholds the resume token until Allow', async () => {
    const ip = newIp();
    const { room, host } = await openHost(ip);
    const { guest, first } = await joinByCode(room.code, ip);
    expect(first.resumeToken).toBeUndefined();
    const peer = await host.next();

    const bad = await joinByResume(room, `${room.roomId}.${'c'.repeat(22)}`, ip);
    expect(bad.first).toEqual({ t: 'error', code: 'bad-code' });

    host.send({ t: 'allow', peerId: peer.peerId });
    const allowed = await guest.nextOf('allowed');
    expect(allowed.resumeToken).toEqual(expect.stringContaining(room.roomId));
  });

  it('refuses sdp from a guest who resumed but is not allowed', async () => {
    const ip = newIp();
    const { room, host, guest, resumeToken } = await lentRoom(ip);
    host.send({ t: 'reclaim' });
    guest.ws.close(1000);
    const back = await joinByResume(room, resumeToken, ip);
    expect(back.first).toMatchObject({ needsAllow: true });
    back.guest.send({ t: 'sdp', sdp: { type: 'answer', sdp: 'v=0' } });
    expect(await back.guest.closed).toBe(1008);
  });

  it('revokes the token and rotates the code on deny', async () => {
    const ip = newIp();
    const { room, host } = await openHost(ip);
    const { guest } = await joinByCode(room.code, ip);
    const peer = await host.nextOf('peer');
    host.send({ t: 'deny', peerId: peer.peerId });
    expect(await guest.next()).toEqual({ t: 'denied' });
    const rotated = await host.nextOf('rotated');
    expect(rotated.code).not.toBe(room.code);

    const next = await joinByCode(rotated.code, ip);
    expect(next.first).toMatchObject({ t: 'joined', needsAllow: true });
  });

  it('tells the host whether a resume needs an Allow', async () => {
    const ip = newIp();
    const { room, host, guest, resumeToken } = await lentRoom(ip);
    guest.ws.close(1000);
    await joinByResume(room, resumeToken, ip);
    expect(await host.nextOf('peer')).toMatchObject({ via: 'resume', needsAllow: false });
    host.send({ t: 'reclaim' });
    await joinByResume(room, resumeToken, ip);
    expect(await host.nextOf('peer')).toMatchObject({ via: 'resume', needsAllow: true });
  });

  it('refuses an already allowed guest on deny without revoking its token or rotating', async () => {
    const ip = newIp();
    const { room, host, peerId, resumeToken } = await lentRoom(ip);
    const back = await joinByResume(room, resumeToken, ip);
    expect(back.first).toMatchObject({ t: 'joined', needsAllow: false });
    const peer = await host.nextOf('peer');
    host.send({ t: 'deny', peerId: peer.peerId });
    expect(await back.guest.next()).toEqual({ t: 'denied' });
    expect(peerId).not.toBe(peer.peerId);

    const again = await joinByResume(room, resumeToken, ip);
    expect(again.first).toMatchObject({ t: 'joined', needsAllow: false });
  });

  it('takes Allow away from a connected guest when the host reclaims', async () => {
    const ip = newIp();
    const { host, guest } = await lentRoom(ip);
    host.send({ t: 'reclaim' });
    host.send({ t: 'ping' });
    await host.nextOf('pong');
    guest.send({ t: 'sdp', sdp: { type: 'answer', sdp: 'v=0' } });
    expect(await guest.closed).toBe(1008);
  });
});

describe('sdp targeting', () => {
  it('drops a host offer addressed to a stale peer and keeps the room alive', async () => {
    const ip = newIp();
    const { host, guest, peerId } = await lentRoom(ip);
    host.send({ t: 'sdp', sdp: { type: 'offer', sdp: 'stale' }, peerId: 'someone-else' });
    host.send({ t: 'sdp', sdp: { type: 'offer', sdp: 'fresh' }, peerId });
    expect(await guest.next()).toEqual({ t: 'sdp', sdp: { type: 'offer', sdp: 'fresh' } });
  });

  it('drops a host offer while the guest is not allowed without closing the room', async () => {
    const ip = newIp();
    const { room, host } = await openHost(ip);
    const { guest } = await joinByCode(room.code, ip);
    const peer = await host.next();
    host.send({ t: 'sdp', sdp: { type: 'offer', sdp: 'early' }, peerId: peer.peerId });
    host.send({ t: 'allow', peerId: peer.peerId });
    expect((await guest.next()).t).toBe('allowed');
  });
});

describe('roles and liveness', () => {
  it.each([{ t: 'allow', peerId: 'x' }, { t: 'rotate' }, { t: 'close' }, { t: 'reclaim' }])(
    'closes a guest that sends host-only $t and keeps the room up',
    async (msg) => {
      const ip = newIp();
      const { host, guest } = await lentRoom(ip);
      guest.send(msg);
      expect(await guest.closed).toBe(1008);
      host.send({ t: 'ping' });
      expect(await host.nextOf('pong')).toEqual({ t: 'pong' });
    },
  );

  it('tells the host when a guest goes away', async () => {
    const ip = newIp();
    const { host, guest, peerId } = await lentRoom(ip);
    guest.ws.close(1000);
    expect(await host.nextOf('peer-gone')).toEqual({ t: 'peer-gone', peerId });
  });

  it('answers ping with pong on both roles', async () => {
    const ip = newIp();
    const { host, guest } = await lentRoom(ip);
    host.send('{ "t": "ping" }');
    expect(await host.next()).toEqual({ t: 'pong' });
    guest.send({ t: 'ping' });
    expect(await guest.next()).toEqual({ t: 'pong' });
  });

  it('cleans up a room whose host never connected', async () => {
    const ip = newIp();
    const room = await createRoom(ip);
    const stub = env.ROOM.get(env.ROOM.idFromString(room.roomId));
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const joined = await joinByCode(room.code, ip);
    expect(joined.first).toEqual({ t: 'error', code: 'no-host' });
  });

  it('strips control characters from the peer label', async () => {
    const ip = newIp();
    const { room, host } = await openHost(ip);
    await joinByCode(room.code, ip, { label: 'Lap\u0007top\n' });
    expect((await host.next()).label).toBe('Laptop');
  });
});

describe('abuse caps', () => {
  it('drops host rotates beyond 10 a minute and keeps the room', async () => {
    const ip = newIp();
    const { host } = await openHost(ip);
    for (let i = 0; i < 10; i++) {
      host.send({ t: 'rotate' });
      await host.nextOf('rotated');
    }
    host.send({ t: 'rotate' });
    host.send({ t: 'ping' });
    expect(await host.nextOf('pong')).toEqual({ t: 'pong' });
    const extra = await Promise.race([host.next(), new Promise<null>((resolve) => setTimeout(() => { resolve(null); }, 200))]);
    expect(extra).toBeNull();
  });

  it('shares one limiter bucket across an IPv6 /64 but not across prefixes', async () => {
    const base = '2001:db8:0:1';
    for (let i = 0; i < 20; i++) {
      const guest = await connect('/room/code/ABCDEF/ws', `${base}::${i + 1}`);
      expect(await guest.next()).toEqual({ t: 'error', code: 'bad-code' });
    }
    const sameNet = await connect('/room/code/ABCDEF/ws', `${base}:aaaa:bbbb:cccc:dddd`);
    expect(await sameNet.next()).toEqual({ t: 'error', code: 'rate-limited' });
    const otherNet = await connect('/room/code/ABCDEF/ws', '2001:db8:0:2::1');
    expect(await otherNet.next()).toEqual({ t: 'error', code: 'bad-code' });
  });
});

describe('host decisions and caps', () => {
  it('ignores an allow addressed to a departed peer', async () => {
    const ip = newIp();
    const { room, host } = await openHost(ip);
    const first = await joinByCode(room.code, ip);
    const stale = await host.nextOf('peer');
    first.guest.ws.close(1000);
    await host.nextOf('peer-gone');
    host.send({ t: 'rotate' });
    const rotated = await host.nextOf('rotated');

    const second = await joinByCode(rotated.code, ip);
    const fresh = await host.nextOf('peer');
    host.send({ t: 'allow', peerId: stale.peerId });
    host.send({ t: 'ping' });
    await host.nextOf('pong');
    expect(second.guest.inbox).toEqual([]);

    host.send({ t: 'allow', peerId: fresh.peerId });
    expect((await second.guest.nextOf('allowed')).t).toBe('allowed');
  });

  it('closes a host whose allow has no peerId', async () => {
    const ip = newIp();
    const { host } = await openHost(ip);
    host.send({ t: 'allow' });
    expect(await host.closed).toBe(1008);
  });

  it('drops host offers beyond the cap without ending the room', async () => {
    const ip = newIp();
    const { host, guest, peerId } = await lentRoom(ip);
    for (let i = 0; i < 25; i++) host.send({ t: 'sdp', sdp: { type: 'offer', sdp: `o${i}` }, peerId });
    host.send({ t: 'ping' });
    await host.nextOf('pong');
    for (let i = 0; i < 20; i++) expect((await guest.next()).sdp.sdp).toBe(`o${i}`);
    expect(guest.inbox).toEqual([]);
    guest.send({ t: 'sdp', sdp: { type: 'answer', sdp: 'still here' } });
    expect((await host.nextOf('sdp')).sdp.sdp).toBe('still here');
  });

  it('closes a guest that floods sdp past the cap', async () => {
    const ip = newIp();
    const { host, guest } = await lentRoom(ip);
    for (let i = 0; i < 21; i++) guest.send({ t: 'sdp', sdp: { type: 'answer', sdp: `a${i}` } });
    expect(await guest.closed).toBe(1008);
    host.send({ t: 'ping' });
    expect(await host.nextOf('pong')).toEqual({ t: 'pong' });
  });
});

describe('lent room', () => {
  it('refuses a newcomer while lent without disturbing the lessee token, and admits one after', async () => {
    const ip = newIp();
    const { room, host, guest, resumeToken } = await lentRoom(ip);
    host.send({ t: 'lent', on: true });
    host.send({ t: 'rotate' });
    const rotated = await host.nextOf('rotated');
    guest.ws.close(1000);

    const newcomer = await joinByCode(rotated.code, ip);
    expect(newcomer.first).toEqual({ t: 'error', code: 'busy' });

    const back = await joinByResume(room, resumeToken, ip);
    expect(back.first).toMatchObject({ t: 'joined', needsAllow: false });

    host.send({ t: 'lent', on: false });
    back.guest.ws.close(1000);
    const later = await joinByCode(rotated.code, ip);
    expect(later.first).toMatchObject({ t: 'joined', needsAllow: true });
  });
});

describe('code state reports', () => {
  it('tells the host when its code is burnt by a join and when it expires', async () => {
    const ip = newIp();
    const { room, host } = await openHost(ip);
    await joinByCode(room.code, ip);
    expect(await host.nextOf('code')).toEqual({ t: 'code', code: room.code, state: 'burnt' });

    const other = await openHost(newIp());
    const stub = env.ROOM.get(env.ROOM.idFromString(other.room.roomId));
    await runDurableObjectAlarm(stub);
    expect(await other.host.nextOf('code')).toEqual({ t: 'code', code: other.room.code, state: 'expired' });
  });
});
