// In-memory FrameChannel pair: frames hop through a microtask (frames sent
// before close() still arrive, like a real data channel), close() ends
// both sides. Like the real data channel wrapper, frames that arrive before
// the first subscriber are held for it, and a close is replayed to late
// onClose subscribers.

import type { FrameChannel } from '@/transport/remote/FrameChannel';

export function createFrameChannelPair(): [FrameChannel, FrameChannel] {
  let closed = false;
  const messageListeners: [Set<(f: Uint8Array) => void>, Set<(f: Uint8Array) => void>] = [new Set(), new Set()];
  const closeListeners: [Set<() => void>, Set<() => void>] = [new Set(), new Set()];
  const held: [Uint8Array[], Uint8Array[]] = [[], []];

  const deliver = (to: 0 | 1, frame: Uint8Array): void => {
    if (messageListeners[to].size === 0) held[to].push(frame);
    else messageListeners[to].forEach((l) => l(frame));
  };

  const end = (self: 0 | 1): FrameChannel => ({
    send: (frame) => {
      if (closed) return;
      const copy = frame.slice();
      queueMicrotask(() => deliver((1 - self) as 0 | 1, copy));
    },
    onMessage: (l) => {
      messageListeners[self].add(l);
      const backlog = held[self].splice(0);
      queueMicrotask(() => backlog.forEach((f) => l(f)));
      return () => { messageListeners[self].delete(l); };
    },
    onClose: (l) => {
      closeListeners[self].add(l);
      if (closed) queueMicrotask(() => { if (closeListeners[self].has(l)) l(); });
      return () => { closeListeners[self].delete(l); };
    },
    close: () => {
      if (closed) return;
      closed = true;
      closeListeners[self].forEach((l) => l());
      queueMicrotask(() => closeListeners[1 - self].forEach((l) => l()));
    },
  });

  return [end(0), end(1)];
}
