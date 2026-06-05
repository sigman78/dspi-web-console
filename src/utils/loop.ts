// Shared scheduling primitives for background loops (poll, notify).

import type { Disposer } from './disposer';

// Pluggable scheduler for one pending callback. next() MUST be idempotent: an
// arm while a callback is pending cancels the prior and arms a fresh one (no
// double-fire). delayMs overrides the factory cadence for that arm (error backoff).
export interface LoopClock {
  next(cb: () => void, delayMs?: number): void;
  cancel(): void;
}

// setTimeout-backed clock with a default cadence of `ms`.
export const timerClock = (ms: number): LoopClock => {
  let id: ReturnType<typeof setTimeout> | null = null;
  return {
    next: (cb, delayMs) => { if (id != null) clearTimeout(id); id = setTimeout(cb, delayMs ?? ms); },
    cancel: () => { if (id != null) clearTimeout(id); id = null; },
  };
};

// requestAnimationFrame-backed clock: paint-aligned and auto-pausing while the
// tab is hidden. Ignores delayMs (rAF has no delay knob).
export const rafClock = (): LoopClock => {
  let id: number | null = null;
  return {
    next: (cb) => { if (id != null) cancelAnimationFrame(id); id = requestAnimationFrame(cb); },
    cancel: () => { if (id != null) cancelAnimationFrame(id); id = null; },
  };
};

// Subscribe to tab visibility: onShow fires when the tab becomes visible, onHide
// when it becomes hidden. Returns a Disposer that removes the listener. No-op
// where document is unavailable (SSR / non-DOM tests).
export function subscribeVisibility(onShow: () => void, onHide: () => void): Disposer {
  if (typeof document === 'undefined') return () => {};
  const handler = () => { if (document.hidden) onHide(); else onShow(); };
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}
