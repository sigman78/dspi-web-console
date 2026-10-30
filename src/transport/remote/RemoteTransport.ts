import type { DspTransport, TransportEvent } from '../DspTransport';
import { TimeoutError } from '../withTimeout';
import type { FrameChannel } from './FrameChannel';
import { RemoteClosed, RemoteRefused } from './errors';
import * as Frames from './frames';
import { errMessage } from '@/utils';

const HANDSHAKE_MS = 5000;

interface Pending {
  resolve(data: Uint8Array): void;
  reject(err: Error): void;
}

export interface RemoteTransportOpts {
  consoleBuild: string;
  wantReadOnly: boolean;
}

// DspTransport that forwards every transfer over a tunnel to the console that
// owns the device. Obtain one with `connect`, which resolves once the peer has
// accepted the handshake. `notifyIn` is present only when the peer reported a
// notify endpoint.
export class RemoteTransport implements DspTransport {
  notifyIn?: (length: number) => Promise<Uint8Array>;

  #channel: FrameChannel;
  #listeners = new Map<TransportEvent, Set<() => void>>();
  #pending = new Map<number, Pending>();
  #nextId = 1;
  #welcomed = false;
  #closed = false;
  #handshake: { resolve(): void; reject(err: Error): void } | null = null;
  #unsubscribe: Array<() => void>;

  private constructor(channel: FrameChannel) {
    this.#channel = channel;
    this.#unsubscribe = [
      channel.onMessage((f) => this.#onFrame(f)),
      channel.onClose(() => this.#teardown(new RemoteClosed())),
    ];
  }

  // Sends HELLO and resolves after WELCOME; rejects on REJECT, version
  // mismatch, channel close, or when the peer stays silent for 5 s.
  static async connect(channel: FrameChannel, opts: RemoteTransportOpts): Promise<RemoteTransport> {
    const t = new RemoteTransport(channel);
    await t.#hello(opts);
    return t;
  }

  #hello(opts: RemoteTransportOpts): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#teardown(new Error(`remote handshake did not complete within ${HANDSHAKE_MS}ms`));
      }, HANDSHAKE_MS);
      this.#handshake = {
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      };
      try {
        this.#channel.send(Frames.encodeFrame({
          type: 'hello',
          version: Frames.TUNNEL_VERSION,
          wantReadOnly: opts.wantReadOnly,
          consoleBuild: opts.consoleBuild,
        }));
      } catch (e) {
        this.#teardown(new RemoteClosed(`remote send failed: ${errMessage(e)}`));
      }
    });
  }

  // Already handshaken by `connect`; fails if the tunnel has since closed.
  open(): Promise<void> {
    return this.#closed ? Promise.reject(new RemoteClosed()) : Promise.resolve();
  }

  async close(): Promise<void> {
    this.#teardown(new RemoteClosed());
  }

  isOpen(): boolean {
    return this.#welcomed && !this.#closed;
  }

  ctrlIn(request: number, value: number, length: number): Promise<Uint8Array> {
    return this.#request((id) => ({ type: 'ctrlIn', id, request, value, length }));
  }

  async ctrlOut(request: number, value: number, data: Uint8Array): Promise<void> {
    await this.#request((id) => ({ type: 'ctrlOut', id, request, value, data }));
  }

  on(event: TransportEvent, listener: () => void): () => void {
    let set = this.#listeners.get(event);
    if (!set) { set = new Set(); this.#listeners.set(event, set); }
    set.add(listener);
    return () => { set.delete(listener); };
  }

  #notifyIn = (length: number): Promise<Uint8Array> =>
    this.#request((id) => ({ type: 'notifyIn', id, length }));

  #emit(event: TransportEvent): void {
    this.#listeners.get(event)?.forEach((l) => l());
  }

  #request(build: (id: number) => Frames.Frame): Promise<Uint8Array> {
    if (this.#closed) return Promise.reject(new RemoteClosed());
    if (!this.#welcomed) return Promise.reject(new Error('RemoteTransport: not open'));
    const id = this.#nextId;
    this.#nextId = this.#nextId === 0xFFFFFFFF ? 1 : this.#nextId + 1;
    return new Promise<Uint8Array>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      try {
        this.#channel.send(Frames.encodeFrame(build(id)));
      } catch (e) {
        this.#pending.delete(id);
        reject(new RemoteClosed(`remote send failed: ${errMessage(e)}`));
      }
    });
  }

  #onFrame(raw: Uint8Array): void {
    if (this.#closed) return;
    let frame: Frames.Frame;
    try {
      frame = Frames.decodeFrame(raw);
    } catch (e) {
      this.#teardown(new Error(`remote protocol error: ${(e as Error).message}`));
      return;
    }
    switch (frame.type) {
      case 'welcome':
        if (!this.#handshake) { this.#teardown(new Error('remote protocol error: unexpected welcome')); return; }
        if (frame.version !== Frames.TUNNEL_VERSION) {
          this.#teardown(new Error(`remote speaks tunnel version ${frame.version}, expected ${Frames.TUNNEL_VERSION}`));
          return;
        }
        this.#welcomed = true;
        if (frame.hasNotify) this.notifyIn = this.#notifyIn;
        this.#handshake.resolve();
        this.#handshake = null;
        this.#emit('connect');
        return;
      case 'reject':
        this.#teardown(new Error(`remote refused the connection (reason ${frame.reason})`));
        return;
      case 'ok':
        this.#settle(frame.id)?.resolve(frame.data);
        return;
      case 'err':
        this.#settle(frame.id)?.reject(errorFor(frame.kind, frame.message));
        return;
      case 'event':
        if (frame.event === Frames.DeviceEvent.Disconnect || frame.event === Frames.DeviceEvent.Release) {
          this.#teardown(new RemoteClosed(frame.event === Frames.DeviceEvent.Release
            ? 'remote released the device'
            : 'remote device disconnected'));
        }
        return;
      default:
        this.#teardown(new Error(`remote protocol error: unexpected ${frame.type} frame`));
    }
  }

  // Late answers for a request already settled find nothing and are dropped.
  #settle(id: number): Pending | undefined {
    const p = this.#pending.get(id);
    this.#pending.delete(id);
    return p;
  }

  #teardown(reason: Error): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#unsubscribe.forEach((u) => u());
    this.#handshake?.reject(reason);
    this.#handshake = null;
    const pending = [...this.#pending.values()];
    this.#pending.clear();
    const closed = reason instanceof RemoteClosed ? reason : new RemoteClosed(reason.message);
    for (const p of pending) p.reject(closed);
    this.#channel.close();
    if (this.#welcomed) this.#emit('disconnect');
  }
}

function errorFor(kind: number, message: string): Error {
  if (kind === Frames.ErrKind.Timeout) {
    // Identity is what callers branch on; keep the peer's text.
    const err = new TimeoutError('remote transfer', 0);
    err.message = message;
    return err;
  }
  if (kind === Frames.ErrKind.Refused) return new RemoteRefused(message);
  return new Error(message);
}
