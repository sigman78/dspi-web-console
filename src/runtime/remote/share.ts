// Device-owner side of relay pairing: opens a room, decides who may join, and
// drives the lease (lease.ts) and the WebRTC handshake for the joiner.

import * as State from '@/state';
import { Log } from '@/utils';
import * as Lease from './lease';
import * as Manual from './manualSignaling';
import * as Peer from './peer';
import * as Relay from './relay';
import * as Signaling from './signaling';
import { withTimeout } from './timeout';
import type { Sdp, ServerMessage } from './relayWire';

const READY_TIMEOUT_MS = 10_000;
const HANDSHAKE_TIMEOUT_MS = 30_000;

// One joiner being served: waiting for an Allow, or taking the offer.
interface Handshake {
  peerId: string;
  label: string;
  cancelled: boolean;
  // Stops this handshake's waits when it is cancelled.
  abort: AbortController;
  // The answer has arrived: the channel's own timeout decides from here.
  answered: boolean;
  lend: Lease.LendHandle | null;
  pc: RTCPeerConnection | null;
  answer: Promise<Sdp>;
  resolveAnswer: (sdp: Sdp) => void;
  rejectAnswer: (err: Error) => void;
}

interface Room {
  socket: Signaling.RoomSocket;
  // The device this room shares; a lend is only made while it is the active one.
  recId: State.ConnId;
  // Stops watching the shared device's session.
  unwatch: () => void;
  hs: Handshake | null;
  // Cancel since the last Allow: the relay wants an Allow again on the next resume.
  reclaimed: boolean;
  // A lend is attached and running.
  attached: boolean;
  // The relay socket is gone but the lend carries on peer to peer.
  orphaned: boolean;
}

let room: Room | null = null;
let starting = false;

function newHandshake(peerId: string, label: string): Handshake {
  let resolveAnswer!: (sdp: Sdp) => void;
  let rejectAnswer!: (err: Error) => void;
  const answer = new Promise<Sdp>((resolve, reject) => {
    resolveAnswer = resolve;
    rejectAnswer = reject;
  });
  answer.catch(() => { /* surfaced by whoever awaits it */ });
  return { peerId, label, cancelled: false, abort: new AbortController(), answered: false, lend: null, pc: null, answer, resolveAnswer, rejectAnswer };
}

function cancelHandshake(r: Room): void {
  const hs = r.hs;
  if (!hs) return;
  r.hs = null;
  hs.cancelled = true;
  hs.abort.abort();
  hs.rejectAnswer(new Error('handshake cancelled'));
  hs.pc?.close();
  if (hs.lend) Lease.abortLend(hs.lend);
  State.setSharePeer(null);
}

// Ends the room on this side. The relay side is closed by the caller.
function teardown(r: Room): void {
  if (room !== r) return;
  cancelHandshake(r);
  room = null;
  r.unwatch();
  Lease.reclaim('stop');
  State.setShareState('idle');
  State.setShareRoom(null);
}

// Prepares the lend first (its pending-changes prompt can take as long as the
// owner likes), only then offers, so the joiner never waits on a prompt inside
// its handshake window.
async function lendTo(r: Room, hs: Handshake, sendAllow: boolean): Promise<void> {
  if (State.activeRecord()?.id !== r.recId) {
    r.socket.send({ t: 'deny', peerId: hs.peerId });
    if (r.hs === hs) { r.hs = null; State.setSharePeer(null); }
    return;
  }
  State.setSharePeer({ peerId: hs.peerId, label: hs.label, stage: 'connecting' });
  try {
    const lend = await Lease.prepareLend({ peerLabel: hs.label, onEnd: (reason) => { onLendEnd(r, reason); } });
    if (!lend) {
      // The joiner learns now instead of timing out.
      if (!hs.cancelled) r.socket.send({ t: 'deny', peerId: hs.peerId });
      if (r.hs === hs) { r.hs = null; State.setSharePeer(null); }
      return;
    }
    hs.lend = lend;
    if (hs.cancelled) { Lease.abortLend(lend); return; }
    // Before the offer: the relay must turn newcomers away from here on. Every
    // way the lend can end reports back through onLendEnd.
    r.socket.send({ t: 'lent', on: true });
    if (sendAllow) {
      r.socket.send({ t: 'allow', peerId: hs.peerId });
      r.reclaimed = false;
    }

    const host = await Manual.createOffer();
    hs.pc = host.pc;
    if (hs.cancelled) { host.pc.close(); Lease.abortLend(lend); return; }
    r.socket.send({ t: 'sdp', sdp: JSON.parse(host.offer) as Sdp, peerId: hs.peerId });

    const answer = await withTimeout(hs.answer, HANDSHAKE_TIMEOUT_MS, 'the answer', hs.abort.signal);
    await Manual.acceptAnswer(host, JSON.stringify(answer));
    await withTimeout(Peer.whenOpen(host.dc), HANDSHAKE_TIMEOUT_MS, 'the data channel', hs.abort.signal);
    if (hs.cancelled) throw new Error('handshake cancelled');

    const channel = Peer.wrapDataChannel(host.pc, host.dc);
    const attached = Lease.attachLend(channel, {
      watchLiveness: (onLost) => Peer.watchPeerLiveness(host.pc, onLost),
    });
    if (!attached) throw new Error('lend dropped before attach');
    r.attached = true;
    if (r.hs === hs) { r.hs = null; State.setSharePeer(null); }
  } catch (err) {
    if (!hs.cancelled) Log.error('remote', 'lend handshake failed', err);
    hs.abort.abort();
    if (hs.lend) Lease.abortLend(hs.lend);
    hs.pc?.close();
    if (r.hs === hs) { r.hs = null; State.setSharePeer(null); }
  }
}

function onLendEnd(r: Room, reason: Lease.LendEnd): void {
  r.attached = false;
  if (room === r) {
    r.socket.send({ t: 'lent', on: false });
    // The device itself is gone: there is nothing left to share.
    if (reason === 'device-gone') closeRoom(r);
  } else if (r.orphaned) {
    State.setShareState('idle');
  }
}

function onPeer(r: Room, msg: Extract<ServerMessage, { t: 'peer' }>): void {
  // Only the returning lessee may replace a running lend; anyone else hears no now.
  if (State.shareState() === 'lent' && r.attached && msg.via !== 'resume') {
    r.socket.send({ t: 'deny', peerId: msg.peerId });
    return;
  }
  cancelHandshake(r);
  // A returning joiner whose old channel the owner has not noticed dying yet.
  if (r.attached) Lease.reclaim('peer-lost');
  const hs = newHandshake(msg.peerId, msg.label);
  r.hs = hs;
  // The relay decides; the owner's own rules can only make it stricter.
  const needsAllow = msg.needsAllow || msg.via === 'code' || (msg.via === 'resume' && r.reclaimed);
  if (needsAllow) State.setSharePeer({ peerId: hs.peerId, label: hs.label, stage: 'pending' });
  else void lendTo(r, hs, false);
}

function onMessage(r: Room, msg: ServerMessage): void {
  if (room !== r) return;
  switch (msg.t) {
    case 'peer':
      onPeer(r, msg);
      return;
    case 'sdp':
      if (r.hs && r.hs.peerId === msg.peerId && msg.sdp.type === 'answer') {
        r.hs.answered = true;
        r.hs.resolveAnswer(msg.sdp);
      }
      return;
    case 'peer-gone':
      // Once lent, the peer connection's own liveness decides; the joiner leaves the relay on purpose.
      // After the answer the channel's own timeout decides.
      if (r.hs?.peerId === msg.peerId && !r.hs.answered) cancelHandshake(r);
      return;
    case 'rotated':
      State.setShareRoom({ code: msg.code, scanKey: msg.scanKey, status: 'live' });
      return;
    case 'code': {
      // A late report about a code that has since been replaced.
      const shown = State.shareRoom();
      if (shown && shown.code === msg.code) State.setShareRoom({ ...shown, status: msg.state });
      return;
    }
    default:
      return;
  }
}

/** Opens a room and starts offering the device. False when the relay is off or sharing is already under way. */
export async function startSharing(): Promise<boolean> {
  const base = Relay.remoteRelayBase();
  const rec = State.activeRecord();
  if (!base || starting || room || State.shareState() !== 'idle' || !rec || rec.remote) return false;
  starting = true;
  State.setShareEnd(null);
  try {
    const created = await Relay.createRoom(base);
    let opened: Signaling.RoomSocket | null = null;
    const ready = new Promise<void>((resolve, reject) => {
      const r: Room = {
        socket: Signaling.openRoomSocket(
          Relay.hostSocketUrl(base, created.roomId),
          { t: 'host', token: created.hostToken },
          {
            onMessage: (msg) => {
              if (msg.t !== 'ready') { onMessage(r, msg); return; }
              room = r;
              // The device died between creating the room and its announcement.
              if (rec.session.signal.aborted) { closeRoom(r); resolve(); return; }
              // Without a lend nothing else notices the device going away.
              const onAbort = (): void => { if (State.shareState() === 'sharing') closeRoom(r); };
              rec.session.signal.addEventListener('abort', onAbort, { once: true });
              r.unwatch = () => { rec.session.signal.removeEventListener('abort', onAbort); };
              State.setShareRoom({ code: msg.code, scanKey: msg.scanKey, status: 'live' });
              State.setShareState('sharing');
              resolve();
            },
            onClose: () => {
              if (room !== r) { reject(new Error('the relay closed the connection')); return; }
              State.setShareEnd('relay-lost');
              if (r.attached) {
                // The tunnel is peer to peer: the lend runs on, the room is gone.
                cancelHandshake(r);
                room = null;
                r.orphaned = true;
                State.setShareRoom(null);
              } else {
                teardown(r);
              }
            },
          },
        ),
        recId: rec.id,
        unwatch: () => {},
        hs: null,
        reclaimed: false,
        attached: false,
        orphaned: false,
      };
      opened = r.socket;
    });
    try {
      await withTimeout(ready, READY_TIMEOUT_MS, 'the relay');
    } catch (err) {
      (opened as Signaling.RoomSocket | null)?.close();
      throw err;
    }
    return true;
  } finally {
    starting = false;
  }
}

/** Replaces the room's code (the old one stops working). The new one arrives through State.shareRoom. */
export function rotateCode(): void {
  room?.socket.send({ t: 'rotate' });
}

/** Lets the pending joiner in. */
export function allow(): void {
  const hs = room?.hs;
  const peer = State.sharePeer();
  if (!room || !hs || peer?.stage !== 'pending' || peer.peerId !== hs.peerId) return;
  void lendTo(room, hs, true);
}

/** Refuses the pending joiner; the relay rotates the code. */
export function deny(): void {
  const hs = room?.hs;
  const peer = State.sharePeer();
  if (!room || !hs || peer?.stage !== 'pending' || peer.peerId !== hs.peerId) return;
  room.socket.send({ t: 'deny', peerId: hs.peerId });
  cancelHandshake(room);
}

function closeRoom(r: Room): void {
  if (room !== r) return;
  r.socket.send({ t: 'close' });
  r.socket.close();
  teardown(r);
}

/** Ends sharing: the room closes and any lend is taken back. */
export function stopSharing(): void {
  if (room) closeRoom(room);
  // The relay is gone but the lend runs on peer to peer.
  else Lease.reclaim('stop');
}

/** Takes the device back from the joiner; the room stays and the joiner needs an Allow to return. */
export function cancelLend(): void {
  const wasLent = State.shareState() === 'lent';
  if (room) cancelHandshake(room);
  Lease.reclaim('cancel');
  if (wasLent && room) {
    room.reclaimed = true;
    room.socket.send({ t: 'reclaim' });
  }
}
