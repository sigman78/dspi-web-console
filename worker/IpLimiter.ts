import { DurableObject } from 'cloudflare:workers';

interface Bucket {
  start: number;
  count: number;
}

/** One instance per client IP: fixed-window attempt counter that deletes itself when the window ends. */
export class IpLimiter extends DurableObject<Env> {
  /** Counts one attempt; false once the window already holds `limit` attempts; refused attempts cost no write. */
  async hit(limit: number, windowMs: number): Promise<boolean> {
    const now = Date.now();
    let w = await this.ctx.storage.get<Bucket>('w');
    if (w && now - w.start < windowMs && w.count >= limit) return false;
    if (!w || now - w.start >= windowMs) {
      w = { start: now, count: 0 };
      await this.ctx.storage.setAlarm(now + windowMs);
    }
    w.count += 1;
    await this.ctx.storage.put('w', w);
    return true;
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
