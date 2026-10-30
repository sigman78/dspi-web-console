import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as State from '@/state';
import { startWakeLock, type WakeLockEnv } from './wakeLock';

class FakeSentinel {
  released = false;
  private listeners: (() => void)[] = [];
  async release(): Promise<void> { this.drop(); }
  addEventListener(_t: 'release', fn: () => void): void { this.listeners.push(fn); }
  drop(): void {
    if (this.released) return;
    this.released = true;
    this.listeners.forEach((fn) => { fn(); });
  }
}

function makeEnv(supported = true) {
  const sentinels: FakeSentinel[] = [];
  const handlers = new Set<() => void>();
  const doc = {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: (_t: string, fn: () => void) => { handlers.add(fn); },
    removeEventListener: (_t: string, fn: () => void) => { handlers.delete(fn); },
  };
  const request = vi.fn(async () => { const s = new FakeSentinel(); sentinels.push(s); return s; });
  const env = { navigator: supported ? { wakeLock: { request } } : {}, document: doc } as unknown as WakeLockEnv;
  const setVisibility = (v: DocumentVisibilityState): void => {
    doc.visibilityState = v;
    if (v === 'hidden') sentinels.forEach((s) => { s.drop(); });
    handlers.forEach((fn) => { fn(); });
  };
  return { env, sentinels, setVisibility, request };
}

const held = (sentinels: FakeSentinel[]): number => sentinels.filter((s) => !s.released).length;
const settle = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); };

let stop: (() => void) | null = null;
beforeEach(() => { State.resetRemoteState(); });
afterEach(() => { stop?.(); stop = null; State.resetRemoteState(); });

describe('screen wake lock', () => {
  it('is taken when sharing starts while visible and released when it ends', async () => {
    const t = makeEnv();
    stop = startWakeLock(t.env);
    expect(held(t.sentinels)).toBe(0);
    State.setShareState('sharing');
    await settle();
    expect(held(t.sentinels)).toBe(1);
    State.setShareState('lent');
    await settle();
    expect(t.sentinels).toHaveLength(1);
    State.setShareState('idle');
    await settle();
    expect(held(t.sentinels)).toBe(0);
  });

  it('is kept while a share is paused waiting for its device', async () => {
    const t = makeEnv();
    stop = startWakeLock(t.env);
    State.setShareState('sharing');
    await settle();
    State.setShareAway({ serial: 'X', until: Date.now() + 1000 });
    State.setShareState('idle');
    await settle();
    expect(held(t.sentinels)).toBe(1);
    State.setShareAway(null);
    await settle();
    expect(held(t.sentinels)).toBe(0);
  });

  it('is taken again when the tab becomes visible after being hidden', async () => {
    const t = makeEnv();
    stop = startWakeLock(t.env);
    State.setShareState('sharing');
    await settle();
    t.setVisibility('hidden');
    await settle();
    expect(held(t.sentinels)).toBe(0);
    t.setVisibility('visible');
    await settle();
    expect(held(t.sentinels)).toBe(1);
  });

  it('waits for visibility when sharing starts in a hidden tab', async () => {
    const t = makeEnv();
    stop = startWakeLock(t.env);
    t.setVisibility('hidden');
    State.setShareState('sharing');
    await settle();
    expect(t.sentinels).toHaveLength(0);
    t.setVisibility('visible');
    await settle();
    expect(held(t.sentinels)).toBe(1);
  });

  it('does nothing without browser support', async () => {
    const t = makeEnv(false);
    stop = startWakeLock(t.env);
    State.setShareState('sharing');
    await settle();
    expect(t.sentinels).toHaveLength(0);
  });

  it('stays quiet when the browser refuses', async () => {
    const t = makeEnv();
    t.request.mockRejectedValueOnce(new DOMException('no', 'NotAllowedError'));
    stop = startWakeLock(t.env);
    State.setShareState('sharing');
    await settle();
    expect(held(t.sentinels)).toBe(0);
    expect(State.notices.list).toHaveLength(0);
  });
});
