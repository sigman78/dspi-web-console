// Serializes a session's device control-transfer sends so a snapshot fetch can
// never interleave with a write mid-flight (no torn reads, no mid-fetch
// collision). Two lanes: normal FIFO for ordinary sends, and a priority lane
// that jumps ahead of queued (not-yet-started) normal ops -- for cadences that
// must not stall behind a slow snapshot fetch (the 20 Hz status poll). The op
// currently running is never preempted; priority only changes what runs next.
// No timers: the pump advances the instant the running op settles.

interface QueueEntry {
  op: () => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

export class QueueDisposedError extends Error {}

export class CommandQueue {
  #normal: QueueEntry[] = [];
  #priority: QueueEntry[] = [];
  #running = false;
  #disposed = false;

  run<T>(op: () => Promise<T>, opts?: { priority?: boolean }): Promise<T> {
    if (this.#disposed) return Promise.reject(new QueueDisposedError('queue disposed'));
    return new Promise<T>((resolve, reject) => {
      const entry: QueueEntry = { op, resolve: resolve as (v: unknown) => void, reject };
      (opts?.priority ? this.#priority : this.#normal).push(entry);
      this.#pump();
    });
  }

  // Drop every queued (not-yet-started) op: each of their run() promises
  // rejects with QueueDisposedError. The op already running is left to finish
  // on its own -- its settle just won't advance to anything (queues are
  // empty). Idempotent; a run() call after this point rejects immediately.
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const dropped = [...this.#priority, ...this.#normal];
    this.#priority = [];
    this.#normal = [];
    for (const entry of dropped) entry.reject(new QueueDisposedError('queue disposed'));
  }

  #pump(): void {
    if (this.#running) return;
    const entry = this.#priority.shift() ?? this.#normal.shift();
    if (!entry) return;
    this.#running = true;
    entry.op().then(entry.resolve, entry.reject).finally(() => {
      this.#running = false;
      this.#pump();
    });
  }
}
