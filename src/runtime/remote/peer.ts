// Adapts a WebRTC peer connection to the tunnel's FrameChannel and watches its
// liveness.

import type { FrameChannel } from '@/transport/remote/FrameChannel';

export const TUNNEL_LABEL = 'dspi-tunnel';

// A transient 'disconnected' often heals on its own; past this it is a lost peer.
export const DISCONNECTED_GRACE_MS = 10_000;

// Upper bound on waiting for the data channel's own close event.
const PEER_CLOSE_FALLBACK_MS = 1000;

export function createTunnelChannel(pc: RTCPeerConnection): RTCDataChannel {
  return pc.createDataChannel(TUNNEL_LABEL, { ordered: true });
}

// Resolves with the tunnel channel the remote side opens; rejects if the
// connection fails or closes first.
export function awaitTunnelChannel(pc: RTCPeerConnection): Promise<RTCDataChannel> {
  return new Promise((resolve, reject) => {
    const settle = (): void => {
      pc.removeEventListener('datachannel', onChannel);
      pc.removeEventListener('connectionstatechange', onState);
    };
    const onChannel = (e: RTCDataChannelEvent): void => {
      if (e.channel.label !== TUNNEL_LABEL) return;
      settle();
      resolve(e.channel);
    };
    const onState = (): void => {
      if (pc.connectionState !== 'failed' && pc.connectionState !== 'closed') return;
      settle();
      reject(new Error(`peer connection ${pc.connectionState} before the tunnel opened`));
    };
    pc.addEventListener('datachannel', onChannel);
    pc.addEventListener('connectionstatechange', onState);
  });
}

export function whenOpen(dc: RTCDataChannel): Promise<void> {
  if (dc.readyState === 'open') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const settle = (): void => {
      dc.removeEventListener('open', onOpen);
      dc.removeEventListener('close', onClose);
    };
    const onOpen = (): void => { settle(); resolve(); };
    const onClose = (): void => { settle(); reject(new Error('tunnel channel closed before it opened')); };
    dc.addEventListener('open', onOpen);
    dc.addEventListener('close', onClose);
  });
}

// Frames that arrive before the first subscriber are held and delivered to it,
// and a close that already happened is replayed to a late onClose subscriber.
// `send` throws while the channel is not open or its buffer is full; callers
// of a FrameChannel treat a throw as a lost peer. close() lets the channel
// flush its final frames before the peer connection is closed.
export function wrapDataChannel(pc: RTCPeerConnection, dc: RTCDataChannel): FrameChannel {
  dc.binaryType = 'arraybuffer';
  const messageListeners = new Set<(frame: Uint8Array) => void>();
  const closeListeners = new Set<() => void>();
  let held: Uint8Array[] | null = [];
  let flushScheduled = false;
  let closed = false;
  let pcTimer: ReturnType<typeof setTimeout> | null = null;

  const closePeer = (): void => {
    if (pcTimer !== null) { clearTimeout(pcTimer); pcTimer = null; }
    pc.close();
  };
  const fireClose = (): void => {
    if (closed) return;
    closed = true;
    closeListeners.forEach((l) => l());
  };

  dc.addEventListener('message', (e) => {
    if (!(e.data instanceof ArrayBuffer)) return;
    const frame = new Uint8Array(e.data);
    if (held) held.push(frame);
    else messageListeners.forEach((l) => l(frame));
  });
  dc.addEventListener('close', () => {
    fireClose();
    closePeer();
  });

  return {
    send: (frame) => {
      if (dc.readyState !== 'open') throw new Error(`tunnel channel is ${dc.readyState}`);
      dc.send(frame as Uint8Array<ArrayBuffer>);
    },
    onMessage: (l) => {
      messageListeners.add(l);
      if (held && !flushScheduled) {
        flushScheduled = true;
        // Deferred so the subscriber finishes its setup first; frames that
        // arrive meanwhile queue behind the backlog.
        queueMicrotask(() => {
          const backlog = held ?? [];
          held = null;
          backlog.forEach((f) => messageListeners.forEach((m) => m(f)));
        });
      }
      return () => { messageListeners.delete(l); };
    },
    onClose: (l) => {
      closeListeners.add(l);
      if (closed) queueMicrotask(() => { if (closeListeners.has(l)) l(); });
      return () => { closeListeners.delete(l); };
    },
    close: () => {
      dc.close();
      fireClose();
      if (dc.readyState === 'closed') closePeer();
      else pcTimer = setTimeout(closePeer, PEER_CLOSE_FALLBACK_MS);
    },
  };
}

// Calls `onLost` once when the peer connection fails, closes, or stays
// disconnected past the grace period. Returns a stop function.
export function watchPeerLiveness(pc: RTCPeerConnection, onLost: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let done = false;
  const clear = (): void => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
  };
  const lose = (): void => {
    if (done) return;
    done = true;
    clear();
    onLost();
  };
  const onChange = (): void => {
    switch (pc.connectionState) {
      case 'failed':
      case 'closed':
        lose();
        return;
      case 'disconnected':
        if (timer === null) timer = setTimeout(lose, DISCONNECTED_GRACE_MS);
        return;
      default:
        clear();
    }
  };
  pc.addEventListener('connectionstatechange', onChange);
  onChange();
  return () => {
    done = true;
    clear();
    pc.removeEventListener('connectionstatechange', onChange);
  };
}
