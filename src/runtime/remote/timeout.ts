// Bounds a wait. An aborted `signal` ends it early and stops the timer.
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const settle = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = (): void => { settle(); reject(new Error(`stopped waiting for ${what}`)); };
    const timer = setTimeout(() => { settle(); reject(new Error(`timed out waiting for ${what}`)); }, ms);
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => { settle(); resolve(v); },
      (e: unknown) => { settle(); reject(e instanceof Error ? e : new Error(String(e))); },
    );
  });
}
