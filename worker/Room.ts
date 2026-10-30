import { DurableObject } from 'cloudflare:workers';
import * as Messages from './messages';
import * as Secrets from './secrets';

export const CODE_TTL_MS = 10 * 60_000;
export const RESUME_TTL_MS = 24 * 60 * 60_000;

const CLOSE_NORMAL = 1000;
const CLOSE_POLICY = 1008;

/** A socket that has not authenticated within this long is dropped. */
const UNAUTH_TTL_MS = 60_000;

const ROTATE_LIMIT = 10;
const SDP_LIMIT = 20;
const BUDGET_WINDOW_MS = 60_000;

interface RoomState {
  hostToken: string;
  code: string;
  scanKey: string;
  codeState: 'live' | 'burnt' | 'expired';
  codeExpiresAt: number;
  resumeSecret: string | null;
  resumeAt: number;
  /** Host took the device back since the last allow: the next resume needs an Allow again. */
  reclaim: boolean;
  /** A typed-code guest has joined and the host has not decided yet. */
  allowPending: boolean;
  /** The host reports the device is lent: only the lessee's resume token gets in. */
  lent?: boolean;
}

/** Fixed-window message counter kept in a socket attachment so it survives hibernation. */
interface Budget {
  start: number;
  count: number;
}

type GuestAttachment = { role: 'guest'; peerId: string; allowed: boolean; sdp?: Budget };

type Attachment =
  | { role: 'new'; at: number }
  | { role: 'host'; rotate?: Budget; sdp?: Budget }
  | GuestAttachment;

export interface Created {
  code: string;
  scanKey: string;
  hostToken: string;
}

/** Returns the budget after counting one message, or null when the window is already full. */
function charge(b: Budget | undefined, limit: number, now: number): Budget | null {
  if (!b || now - b.start >= BUDGET_WINDOW_MS) return { start: now, count: 1 };
  if (b.count >= limit) return null;
  return { start: b.start, count: b.count + 1 };
}

/**
 * One room per shared device. Lives while the host socket is open; the code is
 * a pointer into the room, never its identity.
 */
export class Room extends DurableObject<Env> {
  #s: RoomState | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.#s = (await ctx.storage.get<RoomState>('room')) ?? null;
    });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }

  async create(): Promise<Created> {
    if (this.#s) throw new Error('room already created');
    const s: RoomState = {
      hostToken: Secrets.randomToken(),
      code: '',
      scanKey: '',
      codeState: 'live',
      codeExpiresAt: 0,
      resumeSecret: null,
      resumeAt: 0,
      reclaim: false,
      allowPending: false,
    };
    await this.#issueCode(s);
    this.#s = s;
    await this.#save();
    return { code: s.code, scanKey: s.scanKey, hostToken: s.hostToken };
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    this.#dropStaleSockets();
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ role: 'new', at: Date.now() } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const msg = typeof data === 'string' ? Messages.parseClient(data) : null;
    if (!msg) return this.#violation(ws);
    if (msg.t === 'ping') return this.#send(ws, { t: 'pong' });
    const att = ws.deserializeAttachment() as Attachment | null;
    switch (att?.role) {
      case 'new':
        return this.#onNew(ws, msg);
      case 'host':
        return this.#onHost(ws, att, msg);
      case 'guest':
        return this.#onGuest(ws, att, msg);
      default:
        return this.#violation(ws);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.#onSocketGone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.#onSocketGone(ws);
  }

  /**
   * The single alarm: code expiry while a code is live, otherwise a periodic
   * check that the host is still there (covers a host that never connected and
   * rooms orphaned by a deploy or crash).
   */
  async alarm(): Promise<void> {
    const s = this.#s;
    if (!s) return;
    this.#dropStaleSockets();
    if (!this.#hostSocket()) return this.#closeRoom();
    if (s.codeState === 'live') {
      s.codeState = 'expired';
      await this.#save();
      const host = this.#hostSocket();
      if (host) this.#send(host, { t: 'code', code: s.code, state: 'expired' });
      await this.env.CODE_PTR.getByName(s.code).end('expired');
    }
    await this.ctx.storage.setAlarm(Date.now() + RESUME_TTL_MS);
  }

  async #onSocketGone(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (att?.role === 'host') return this.#closeRoom();
    if (att?.role === 'guest') {
      const host = this.#hostSocket();
      if (host) this.#send(host, { t: 'peer-gone', peerId: att.peerId });
    }
  }

  async #onNew(ws: WebSocket, msg: Messages.ClientMessage): Promise<void> {
    const s = this.#s;
    if (msg.t === 'host') {
      if (!s || !Secrets.equal(msg.token, s.hostToken) || this.#hostSocket()) return this.#violation(ws);
      ws.serializeAttachment({ role: 'host' } satisfies Attachment);
      this.#send(ws, { t: 'ready', code: s.code, scanKey: s.scanKey });
      return;
    }
    if (msg.t === 'join') return this.#join(ws, msg);
    return this.#violation(ws);
  }

  async #join(ws: WebSocket, msg: Extract<Messages.ClientMessage, { t: 'join' }>): Promise<void> {
    const s = this.#s;
    const host = this.#hostSocket();
    if (!s || !host) return this.#reject(ws, 'no-host');

    const now = Date.now();
    let via: 'code' | 'scan' | 'resume';
    let needsAllow: boolean;
    let burn = false;

    if (msg.resume !== undefined) {
      const dot = msg.resume.indexOf('.');
      const roomId = msg.resume.slice(0, dot);
      const secret = msg.resume.slice(dot + 1);
      const valid =
        dot > 0 &&
        s.resumeSecret !== null &&
        roomId === this.ctx.id.toString() &&
        Secrets.equal(secret, s.resumeSecret) &&
        now - s.resumeAt < RESUME_TTL_MS;
      if (!valid) return this.#reject(ws, 'bad-code');
      via = 'resume';
      needsAllow = s.reclaim || s.allowPending;
      // Same lessee coming back: a stale socket must not lock them out.
      for (const old of this.#guestSockets()) old.close(CLOSE_NORMAL, 'replaced');
    } else {
      // A newcomer must not re-mint the secret the current lessee holds.
      if (s.lent || this.#guestSockets().length > 0) return this.#reject(ws, 'busy');
      if (s.codeState === 'burnt') return this.#reject(ws, 'burnt');
      if (s.codeState === 'expired' || now >= s.codeExpiresAt) return this.#reject(ws, 'expired');
      if (msg.code !== s.code) return this.#reject(ws, 'bad-code');
      if (msg.scanKey !== undefined && !Secrets.equal(msg.scanKey, s.scanKey)) return this.#reject(ws, 'bad-code');
      via = msg.scanKey === undefined ? 'code' : 'scan';
      needsAllow = via === 'code';
      burn = true;
    }

    // Everything above is synchronous so two racing joins cannot both pass the busy check.
    const peerId = Secrets.randomToken().slice(0, 8);
    ws.serializeAttachment({ role: 'guest', peerId, allowed: !needsAllow } satisfies Attachment);
    if (burn) {
      s.codeState = 'burnt';
      s.resumeSecret = Secrets.randomToken();
    }
    s.allowPending = needsAllow;
    s.resumeAt = now;

    // A rotate can land while the awaits below run; the report names the code that burnt.
    const burntCode = s.code;
    await this.#save();
    if (burn) {
      await this.ctx.storage.setAlarm(now + RESUME_TTL_MS);
      await this.env.CODE_PTR.getByName(burntCode).end('burnt');
    }
    // The token is withheld until the host allows: holding it must not skip the Allow.
    this.#send(ws, needsAllow ? { t: 'joined', needsAllow } : { t: 'joined', needsAllow, resumeToken: this.#resumeToken(s) });
    this.#send(host, { t: 'peer', peerId, via, needsAllow, label: msg.label });
    if (burn) this.#send(host, { t: 'code', code: burntCode, state: 'burnt' });
  }

  async #onHost(ws: WebSocket, att: Extract<Attachment, { role: 'host' }>, msg: Messages.ClientMessage): Promise<void> {
    const s = this.#s;
    if (!s) return this.#violation(ws);
    const guest = this.#guestSockets()[0];
    const gatt = guest?.deserializeAttachment() as GuestAttachment | undefined;
    const now = Date.now();

    switch (msg.t) {
      case 'sdp': {
        if (msg.peerId === undefined) return this.#violation(ws);
        // Over the cap is dropped, not punished: a guest rejoining in a loop can make the host re-offer.
        const sdp = charge(att.sdp, SDP_LIMIT, now);
        if (!sdp) return;
        ws.serializeAttachment({ ...att, sdp } satisfies Attachment);
        if (guest && gatt && gatt.allowed && gatt.peerId === msg.peerId) this.#send(guest, { t: 'sdp', sdp: msg.sdp });
        return;
      }
      case 'allow':
        if (!guest || !gatt || gatt.allowed || gatt.peerId !== msg.peerId || !s.resumeSecret) return;
        guest.serializeAttachment({ ...gatt, allowed: true } satisfies Attachment);
        s.reclaim = false;
        s.allowPending = false;
        await this.#save();
        this.#send(guest, { t: 'allowed', resumeToken: this.#resumeToken(s) });
        return;
      case 'deny':
        if (!guest || !gatt || gatt.peerId !== msg.peerId) return;
        if (gatt.allowed) {
          // Plain refusal of a guest that needed no Allow: the room and its token stay.
          this.#send(guest, { t: 'denied' });
          guest.close(CLOSE_NORMAL, 'denied');
          return;
        }
        s.resumeSecret = null;
        s.allowPending = false;
        this.#send(guest, { t: 'denied' });
        guest.close(CLOSE_NORMAL, 'denied');
        await this.#rotate(ws, s);
        return;
      case 'rotate': {
        const rotate = charge(att.rotate, ROTATE_LIMIT, now);
        if (!rotate) return this.#violation(ws);
        ws.serializeAttachment({ ...att, rotate } satisfies Attachment);
        await this.#rotate(ws, s);
        return;
      }
      case 'lent':
        if (s.lent === msg.on) return;
        s.lent = msg.on;
        await this.#save();
        return;
      case 'reclaim':
        s.reclaim = true;
        if (guest && gatt) guest.serializeAttachment({ ...gatt, allowed: false } satisfies Attachment);
        await this.#save();
        return;
      case 'close':
        return this.#closeRoom();
      default:
        return this.#violation(ws);
    }
  }

  async #onGuest(ws: WebSocket, att: GuestAttachment, msg: Messages.ClientMessage): Promise<void> {
    if (msg.t !== 'sdp' || !att.allowed) return this.#violation(ws);
    const sdp = charge(att.sdp, SDP_LIMIT, Date.now());
    if (!sdp) return this.#violation(ws);
    ws.serializeAttachment({ ...att, sdp } satisfies Attachment);
    const host = this.#hostSocket();
    if (host) this.#send(host, { t: 'sdp', sdp: msg.sdp, peerId: att.peerId });
  }

  async #rotate(host: WebSocket, s: RoomState): Promise<void> {
    const old = s.code;
    await this.#issueCode(s);
    await this.#save();
    await this.env.CODE_PTR.getByName(old).end('expired');
    this.#send(host, { t: 'rotated', code: s.code, scanKey: s.scanKey });
  }

  /** Mints a fresh code and scan key and (re)arms the expiry alarm. */
  async #issueCode(s: RoomState): Promise<void> {
    const roomId = this.ctx.id.toString();
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = Secrets.randomCode();
      if (await this.env.CODE_PTR.getByName(code).open(roomId, CODE_TTL_MS)) {
        s.code = code;
        s.scanKey = Secrets.randomToken();
        s.codeState = 'live';
        s.codeExpiresAt = Date.now() + CODE_TTL_MS;
        await this.ctx.storage.setAlarm(s.codeExpiresAt);
        return;
      }
    }
    throw new Error('no free code');
  }

  #resumeToken(s: RoomState): string {
    return `${this.ctx.id.toString()}.${s.resumeSecret}`;
  }

  async #closeRoom(): Promise<void> {
    const s = this.#s;
    this.#s = null;
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att?.role === 'guest') this.#send(ws, { t: 'host-gone' });
      ws.close(CLOSE_NORMAL, att?.role === 'guest' ? 'host-gone' : 'closed');
    }
    if (s) await this.env.CODE_PTR.getByName(s.code).end('closed');
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  async #save(): Promise<void> {
    await this.ctx.storage.put('room', this.#s);
  }

  #sockets(role: Attachment['role']): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => (ws.deserializeAttachment() as Attachment | null)?.role === role);
  }

  #hostSocket(): WebSocket | undefined {
    return this.#sockets('host')[0];
  }

  #guestSockets(): WebSocket[] {
    return this.#sockets('guest').filter((ws) => ws.readyState === WebSocket.OPEN);
  }

  #dropStaleSockets(): void {
    const cutoff = Date.now() - UNAUTH_TTL_MS;
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att?.role === 'new' && att.at < cutoff) ws.close(CLOSE_POLICY, 'unauthenticated');
    }
  }

  #send(ws: WebSocket, msg: Messages.ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  #reject(ws: WebSocket, code: Messages.ErrorCode): void {
    this.#send(ws, { t: 'error', code });
    ws.close(CLOSE_NORMAL, code);
  }

  async #violation(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    ws.close(CLOSE_POLICY, 'protocol');
    if (att?.role === 'host') await this.#closeRoom();
  }
}
