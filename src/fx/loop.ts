export interface FxLoopOptions {
  /** Called once per drawn frame with the rAF timestamp and the clamped delta, in ms. */
  frame: (nowMs: number, dtMs: number) => void;
  /** When true, frames are throttled to `reducedGapMs`. */
  reducedMotion?: () => boolean;
  reducedGapMs?: number;
}

export interface FxLoop {
  start(): void;
  stop(): void;
  /** Stops and detaches the visibility listener. */
  dispose(): void;
}

/** requestAnimationFrame driver that pauses while the tab is hidden. */
export function createFxLoop(opts: FxLoopOptions): FxLoop {
  const gap = opts.reducedGapMs ?? 250;
  let raf = 0;
  let last = 0;

  function tick(now: number): void {
    raf = requestAnimationFrame(tick);
    if (last !== 0 && opts.reducedMotion?.() && now - last < gap) return;
    const dt = last === 0 ? 16 : Math.min(100, now - last);
    last = now;
    opts.frame(now, dt);
  }
  function start(): void {
    if (raf !== 0 || document.hidden) return;
    last = 0;
    raf = requestAnimationFrame(tick);
  }
  function stop(): void {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  function onVisibility(): void {
    if (document.hidden) stop(); else start();
  }
  document.addEventListener('visibilitychange', onVisibility);
  return {
    start,
    stop,
    dispose() {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
