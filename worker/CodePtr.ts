import { DurableObject } from 'cloudflare:workers';
import type { ErrorCode } from './messages';

/** Why a code stopped resolving. */
export type CodeEnd = 'burnt' | 'expired' | 'closed';

interface Pointer {
  roomId: string;
  state: 'live' | CodeEnd;
  expiresAt: number;
}

/** How long a dead pointer is kept so a late guess still gets a precise error. */
const TOMBSTONE_MS = 60 * 60_000;

export type Resolution = { roomId: string } | { error: ErrorCode };

/** One instance per code (named by the code): maps a short-lived code to its room. */
export class CodePtr extends DurableObject<Env> {
  /** Claims this code for a room. False when it is currently live for another room. */
  async open(roomId: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const cur = await this.ctx.storage.get<Pointer>('ptr');
    if (cur && cur.state === 'live' && cur.expiresAt > now) return false;
    await this.ctx.storage.put<Pointer>('ptr', { roomId, state: 'live', expiresAt: now + ttlMs });
    await this.ctx.storage.setAlarm(now + ttlMs + TOMBSTONE_MS);
    return true;
  }

  async resolve(): Promise<Resolution> {
    const cur = await this.ctx.storage.get<Pointer>('ptr');
    if (!cur) return { error: 'bad-code' };
    if (cur.state === 'live') return cur.expiresAt > Date.now() ? { roomId: cur.roomId } : { error: 'expired' };
    return { error: cur.state === 'closed' ? 'no-host' : cur.state };
  }

  async end(reason: CodeEnd): Promise<void> {
    const cur = await this.ctx.storage.get<Pointer>('ptr');
    if (cur && cur.state === 'live') await this.ctx.storage.put<Pointer>('ptr', { ...cur, state: reason });
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
