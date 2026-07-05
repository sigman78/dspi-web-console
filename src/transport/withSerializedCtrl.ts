import type { DspTransport, TransportEvent } from './DspTransport';

// The firmware's chunked bulk sessions (0xA2/0xA3) are torn down by any vendor
// request interleaved between chunks, so every control transfer -- chunked or
// not -- funnels through one FIFO queue. `exclusive` lets a caller run a
// multi-transfer sequence (e.g. a whole chunked read) as one atomic unit
// against that same queue.
export interface SerializedDspTransport extends DspTransport {
  exclusive<T>(fn: (raw: DspTransport) => Promise<T>): Promise<T>;
}

export function withSerializedCtrl(inner: DspTransport): SerializedDspTransport {
  // `tail` always settles (never rejects): each link swallows its own outcome
  // before becoming the next link's predecessor, so one op's failure can't
  // stall ops queued behind it.
  let tail: Promise<void> = Promise.resolve();

  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const result = tail.then(fn);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };

  return {
    open: () => inner.open(),
    close: () => inner.close(),
    isOpen: () => inner.isOpen(),
    on: (event: TransportEvent, listener: () => void) => inner.on(event, listener),
    ctrlIn: (request, value, length) => enqueue(() => inner.ctrlIn(request, value, length)),
    ctrlOut: (request, value, data) => enqueue(() => inner.ctrlOut(request, value, data)),
    exclusive: <T>(fn: (raw: DspTransport) => Promise<T>) => enqueue(() => fn(inner)),
    ...(inner.notifyIn
      ? { notifyIn: (length: number) => inner.notifyIn!(length) }
      : {}),
  };
}
