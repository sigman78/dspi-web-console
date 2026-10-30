// In-memory FrameChannel pair: frames hop through a microtask (frames sent
// before close() still arrive, like a real data channel), close() ends
// both sides.

import type { FrameChannel } from '@/transport/remote/FrameChannel';

export function createFrameChannelPair(): [FrameChannel, FrameChannel] {
  let closed = false;
  const messageListeners: [Set<(f: Uint8Array) => void>, Set<(f: Uint8Array) => void>] = [new Set(), new Set()];
  const closeListeners: [Set<() => void>, Set<() => void>] = [new Set(), new Set()];

  const end = (self: 0 | 1): FrameChannel => ({
    send: (frame) => {
      if (closed) return;
      const copy = frame.slice();
      queueMicrotask(() => {
        messageListeners[1 - self].forEach((l) => l(copy));
      });
    },
    onMessage: (l) => { messageListeners[self].add(l); return () => { messageListeners[self].delete(l); }; },
    onClose: (l) => { closeListeners[self].add(l); return () => { closeListeners[self].delete(l); }; },
    close: () => {
      if (closed) return;
      closed = true;
      closeListeners[self].forEach((l) => l());
      queueMicrotask(() => closeListeners[1 - self].forEach((l) => l()));
    },
  });

  return [end(0), end(1)];
}
