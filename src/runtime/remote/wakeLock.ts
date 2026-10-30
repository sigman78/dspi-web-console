// Keeps the screen awake while this console shares or lends its device: a
// sleeping screen would stall the tab that carries the tunnel.

import * as State from '@/state';

interface Sentinel {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

export interface WakeLockEnv {
  navigator: { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } };
  document: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
}

/** Holds a screen wake lock while sharing, re-taking it when the tab becomes visible again. Returns the stop function. */
export function startWakeLock(env: WakeLockEnv): () => void {
  const api = env.navigator.wakeLock;
  if (!api) return () => {};
  let sentinel: Sentinel | null = null;
  let requesting = false;
  let wanted = false;

  const release = (): void => {
    const held = sentinel;
    sentinel = null;
    if (held && !held.released) held.release().catch(() => {});
  };

  const acquire = (): void => {
    if (!wanted || requesting || env.document.visibilityState !== 'visible') return;
    if (sentinel && !sentinel.released) return;
    requesting = true;
    api.request('screen').then((got) => {
      requesting = false;
      if (!wanted) { got.release().catch(() => {}); return; }
      sentinel = got;
      got.addEventListener('release', () => { if (sentinel === got) sentinel = null; });
    }).catch(() => { requesting = false; });
  };

  const sync = (): void => {
    // A paused share keeps the screen on too: the room is still waiting for its device.
    wanted = State.shareState() !== 'idle' || State.shareAway() !== null;
    if (wanted) acquire(); else release();
  };

  const offState = State.onShareActivity(sync);
  env.document.addEventListener('visibilitychange', acquire);
  sync();
  return () => {
    offState();
    env.document.removeEventListener('visibilitychange', acquire);
    wanted = false;
    release();
  };
}

let stopDefault: (() => void) | null = null;

/** Starts the wake lock for the real browser, once. */
export function ensureWakeLock(): void {
  stopDefault ??= startWakeLock({ navigator, document });
}
