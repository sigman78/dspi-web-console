import { fmtCmdId } from '@/protocol/wireMonitor';
import type { DspTransport, TransportEvent } from './DspTransport';

export class TimeoutError extends Error {
  override readonly name = 'DspTimeoutError';
  constructor(operation: string, ms: number) {
    super(`${operation} did not complete within ${ms}ms`);
  }
}

export interface TimeoutOpts {
  // Per-call timeout in ms. Applies to both ctrlIn and ctrlOut.
  ctrlMs: number;
}

// Decorator: ctrlIn/ctrlOut reject with TimeoutError if they don't settle
// within `opts.ctrlMs`. The underlying transfer is NOT cancelled (WebUSB has no
// AbortSignal); the promise just rejects. Safe because the transport surface is
// single-in-flight from the mutation pipeline's perspective.
export function withTimeout(inner: DspTransport, opts: TimeoutOpts): DspTransport {
  const race = <T>(operation: string, p: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new TimeoutError(operation, opts.ctrlMs)), opts.ctrlMs);
    });
    return Promise.race([p, timeout]).finally(() => {
      if (timer !== null) clearTimeout(timer);
    });
  };

  return {
    open: () => inner.open(),
    close: () => inner.close(),
    isOpen: () => inner.isOpen(),
    on: (event: TransportEvent, listener: () => void) => inner.on(event, listener),
    ctrlIn: (cmd, value, length) =>
      race(`ctrlIn(${fmtCmdId(cmd)}, w=${value})`, inner.ctrlIn(cmd, value, length)),
    ctrlOut: (cmd, value, data) =>
      race(`ctrlOut(${fmtCmdId(cmd)}, w=${value})`, inner.ctrlOut(cmd, value, data)),
    // Notify reads are open-ended (the device may withhold until an event);
    // they are not control transfers, so they are not subject to ctrlMs.
    ...(inner.notifyIn
      ? { notifyIn: (length: number) => inner.notifyIn!(length) }
      : {}),
  };
}
