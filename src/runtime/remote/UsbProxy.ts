// Device-side end of the tunnel: executes a remote console's transfers on the
// local transport, subject to the lease policy. The remote peer is untrusted.

import type { SerializedDspTransport } from '@/transport/withSerializedCtrl';
import { TimeoutError } from '@/transport/withTimeout';
import type { FrameChannel } from '@/transport/remote/FrameChannel';
import * as Frames from '@/transport/remote/frames';
import { errMessage } from '@/utils';
import type { LeasePolicy } from './allowlist';

// Queued plus in-flight control transfers a peer may have outstanding.
const MAX_OUTSTANDING = 64;

export interface UsbProxyOpts {
  consoleBuild: string;
  // Fires when the proxy ends for any reason other than stop(): 'device' when
  // the local transport disconnected, 'peer' for everything else.
  onClosed: (reason: 'peer' | 'device') => void;
}

export interface UsbProxy {
  stop(reason: 'release' | 'disconnect'): void;
}

export function startUsbProxy(
  transport: SerializedDspTransport,
  channel: FrameChannel,
  policy: LeasePolicy,
  opts: UsbProxyOpts,
): UsbProxy {
  let stopped = false;
  let greeted = false;
  let notifyPending = false;
  let draining = false;
  let outstanding = 0;
  const fifo: Array<() => Promise<void>> = [];
  const unsubscribe: Array<() => void> = [];

  // A channel that cannot take a frame (closing, buffer full) is a lost peer.
  const send = (f: Frames.Frame): void => {
    if (stopped) return;
    try {
      channel.send(Frames.encodeFrame(f));
    } catch {
      finish(null, 'peer');
    }
  };
  const ok = (id: number, data: Uint8Array): void => send({ type: 'ok', id, data });
  const err = (id: number, kind: number, message: string): void => send({ type: 'err', id, kind, message });

  const fail = (id: number, e: unknown): void => {
    if (e instanceof TimeoutError) err(id, Frames.ErrKind.Timeout, e.message);
    else if (!transport.isOpen()) err(id, Frames.ErrKind.NotOpen, errMessage(e));
    else err(id, Frames.ErrKind.Transport, errMessage(e));
  };

  const finish = (event: number | null, notify: 'peer' | 'device' | null): void => {
    if (stopped) return;
    stopped = true;
    if (event !== null) {
      try {
        channel.send(Frames.encodeFrame({ type: 'event', event }));
      } catch {}
    }
    fifo.length = 0;
    unsubscribe.forEach((u) => u());
    try {
      channel.close();
    } catch {}
    if (notify) opts.onClosed(notify);
  };

  const drain = async (): Promise<void> => {
    if (draining) return;
    draining = true;
    try {
      while (fifo.length > 0) {
        try {
          await fifo.shift()!();
        } finally {
          outstanding--;
        }
      }
    } finally {
      draining = false;
    }
  };
  const enqueue = (task: () => Promise<void>): void => {
    if (outstanding >= MAX_OUTSTANDING) { finish(null, 'peer'); return; }
    outstanding++;
    fifo.push(task);
    void drain();
  };

  // Separate from the control FIFO: a notify read stays open until the device
  // has an event and must not hold up control traffic.
  const serveNotify = async (id: number, length: number): Promise<void> => {
    if (!transport.notifyIn) { err(id, Frames.ErrKind.Transport, 'notifyIn: not supported'); return; }
    if (notifyPending) { err(id, Frames.ErrKind.Transport, 'notifyIn: already pending'); return; }
    if (length > Frames.MAX_PAYLOAD) { err(id, Frames.ErrKind.Refused, 'notifyIn: length refused'); return; }
    notifyPending = true;
    try {
      ok(id, await transport.notifyIn(length));
    } catch (e) {
      fail(id, e);
    } finally {
      notifyPending = false;
    }
  };

  const onFrame = (frame: Frames.Frame): void => {
    if (frame.type === 'hello') {
      if (greeted) { finish(null, 'peer'); return; }
      if (frame.version !== Frames.TUNNEL_VERSION) {
        send({ type: 'reject', reason: Frames.RejectReason.Version });
        finish(null, 'peer');
        return;
      }
      greeted = true;
      send({
        type: 'welcome',
        version: Frames.TUNNEL_VERSION,
        leaseKind: policy.readOnly ? Frames.LeaseKind.ReadOnly : Frames.LeaseKind.Full,
        hasNotify: transport.notifyIn !== undefined,
        consoleBuild: opts.consoleBuild,
      });
      return;
    }
    if (!greeted) { finish(null, 'peer'); return; }

    switch (frame.type) {
      case 'ctrlIn':
        enqueue(async () => {
          if (frame.length > Frames.MAX_PAYLOAD || !policy.allows(frame.request, 'in')) {
            err(frame.id, Frames.ErrKind.Refused, `ctrlIn(0x${frame.request.toString(16)}) refused`);
            return;
          }
          try {
            ok(frame.id, await transport.ctrlIn(frame.request, frame.value, frame.length));
          } catch (e) {
            fail(frame.id, e);
          }
        });
        return;
      case 'ctrlOut':
        enqueue(async () => {
          if (frame.data.length > Frames.MAX_PAYLOAD || !policy.allows(frame.request, 'out')) {
            err(frame.id, Frames.ErrKind.Refused, `ctrlOut(0x${frame.request.toString(16)}) refused`);
            return;
          }
          try {
            await transport.ctrlOut(frame.request, frame.value, frame.data);
            ok(frame.id, new Uint8Array(0));
          } catch (e) {
            fail(frame.id, e);
          }
        });
        return;
      case 'notifyIn':
        void serveNotify(frame.id, frame.length);
        return;
      default:
        finish(null, 'peer');
    }
  };

  unsubscribe.push(channel.onMessage((raw) => {
    if (stopped) return;
    let frame: Frames.Frame;
    try {
      frame = Frames.decodeFrame(raw);
    } catch {
      finish(null, 'peer');
      return;
    }
    onFrame(frame);
  }));
  unsubscribe.push(channel.onClose(() => finish(null, 'peer')));
  unsubscribe.push(transport.on('disconnect', () => finish(Frames.DeviceEvent.Disconnect, 'device')));
  // A listener that fired during registration ended the proxy before the rest
  // were subscribed.
  if (stopped) unsubscribe.forEach((u) => u());

  return {
    stop: (reason) => finish(
      reason === 'release' ? Frames.DeviceEvent.Release : Frames.DeviceEvent.Disconnect,
      null,
    ),
  };
}
