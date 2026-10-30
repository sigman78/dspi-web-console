// Device-owner side of remote control: hands the active device to one remote
// console and takes it back.

import * as State from '@/state';
import { GIT_SHA } from '@/buildInfo';
import type { FrameChannel } from '@/transport/remote/FrameChannel';
import * as Frames from '@/transport/remote/frames';
import { activateRecord, deactivateRecord, hasPendingWork } from '@/runtime/deviceService';
import { startUsbProxy, type UsbProxy } from './UsbProxy';
import { createLeasePolicy } from './allowlist';

export type ReclaimReason = 'cancel' | 'peer-lost' | 'stop';

export interface PrepareOptions {
  peerLabel: string;
}

export interface AttachOptions {
  // Subscribes to the peer's liveness; the returned function unsubscribes.
  watchLiveness?: (onLost: () => void) => () => void;
}

interface Lend {
  rec: State.DeviceRecord;
  proxy: UsbProxy | null;
  offAbort: () => void;
  stopWatch: (() => void) | null;
}

let current: Lend | null = null;
let preparing = false;

function refuse(channel: FrameChannel, reason: number): void {
  try {
    channel.send(Frames.encodeFrame({ type: 'reject', reason }));
  } catch { /* the peer is already gone */ }
  channel.close();
}

// First half of a lend: takes the active record off the wire (pending-changes
// prompt, lease, loops stopped, writes flushed) so that nothing human-paced
// sits between the peer connecting and the proxy attaching. Resolves false
// when the lend is refused: another lessee holds the device, nothing lendable
// is active, or the user declined the prompt. A prepared lend must end in
// attachLend or abortLend.
export async function prepareLend(opts: PrepareOptions): Promise<boolean> {
  const rec = State.activeRecord();
  if (preparing || current || !rec || rec.remote || State.leaseOf(rec.id)) return false;
  preparing = true;
  try {
    if (hasPendingWork(rec.session)) {
      const choice = await State.askBoundary({
        title: 'Pending changes',
        message: 'This device has changes that are not applied or not saved. They stay with it, but nothing is sent from this console while another console is in control.',
        discardLabel: 'Hand over',
      });
      if (choice === 'cancel') return false;
    }
    if (State.activeRecord()?.id !== rec.id || !rec.session.alive) return false;

    // The lease goes up before the flush so a promotion during it cannot
    // restart this record's loops.
    const onAbort = (): void => endLend(rec);
    rec.session.signal.addEventListener('abort', onAbort, { once: true });
    const lend: Lend = {
      rec,
      proxy: null,
      offAbort: () => { rec.session.signal.removeEventListener('abort', onAbort); },
      stopWatch: null,
    };
    current = lend;
    State.setLease(rec.id, { peerLabel: opts.peerLabel, since: Date.now() });
    State.setShareState('lent');
    await deactivateRecord(rec);
    if (current !== lend) return false;   // the device went away meanwhile
    if (State.activeRecord()?.id !== rec.id) {
      reclaim('cancel');
      return false;
    }
    return true;
  } finally {
    preparing = false;
  }
}

// Second half: serves the prepared lend over `channel`. Resolves false (and
// closes the channel) when no prepared lend is waiting.
export function attachLend(channel: FrameChannel, opts: AttachOptions = {}): boolean {
  const lend = current;
  if (!lend || lend.proxy || preparing) {
    refuse(channel, Frames.RejectReason.Busy);
    return false;
  }
  const { rec } = lend;
  lend.proxy = startUsbProxy(rec.session.device.transport, channel, createLeasePolicy(false), {
    consoleBuild: GIT_SHA,
    onClosed: (reason) => {
      if (reason === 'peer') reclaim('peer-lost');
      else endLend(rec);
    },
  });
  const stopWatch = opts.watchLiveness?.(() => reclaim('peer-lost')) ?? null;
  if (current === lend) lend.stopWatch = stopWatch;
  else stopWatch?.();
  return true;
}

// Gives up a prepared lend whose channel never came.
export function abortLend(): void {
  if (current && !current.proxy) reclaim('cancel');
}

// Takes the device back. `cancel` and `peer-lost` keep sharing so the peer can
// return; `stop` ends sharing.
export function reclaim(reason: ReclaimReason): void {
  const lend = current;
  if (!lend) return;
  current = null;
  lend.offAbort();
  lend.stopWatch?.();
  lend.proxy?.stop(reason === 'peer-lost' ? 'disconnect' : 'release');
  State.clearLease(lend.rec.id);
  State.setShareState(reason === 'stop' ? 'idle' : 'sharing');
  const { rec } = lend;
  if (!rec.session.alive) return;
  // The lessee may have changed anything, so resync eagerly.
  if (State.activeRecord()?.id === rec.id) activateRecord(rec);
  rec.session.mirror.requestReconcile(true);
}

// The local device is gone: there is nothing to hand back.
function endLend(rec: State.DeviceRecord): void {
  const lend = current;
  if (!lend || lend.rec !== rec) return;
  current = null;
  lend.offAbort();
  lend.stopWatch?.();
  lend.proxy?.stop('disconnect');
  State.clearLease(rec.id);
  State.setShareState('idle');
}
