// Joining side of relay pairing: gets in with a typed code, a scanned link or
// a stored resume token, answers the owner's offer and hands the tunnel to
// joinRemote. Progress and failures are reported through State.joinState.

import * as State from '@/state';
import { Log } from '@/utils';
import { joinRemote } from './join';
import * as Identity from './identity';
import * as Manual from './manualSignaling';
import * as Peer from './peer';
import * as Relay from './relay';
import * as Store from './relayStore';
import * as Signaling from './signaling';
import type { FrameChannel } from '@/transport/remote/FrameChannel';
import * as Wire from './relayWire';
import { withTimeout } from './timeout';

// The owner may sit in a pending-changes prompt before offering.
const OFFER_TIMEOUT_MS = 60_000;
const CHANNEL_TIMEOUT_MS = 30_000;

// What the owner's console is called here; the relay carries no label for it.
const HOST_LABEL = 'Host console';

interface Attempt {
  socket: Signaling.RoomSocket | null;
  resumed: boolean;
  pc: RTCPeerConnection | null;
  offerTimer: ReturnType<typeof setTimeout> | null;
  // Stops the handshake's waits when the attempt ends.
  abort: AbortController;
}

let attempt: Attempt | null = null;
// Bumped by every new or abandoned attempt so a superseded one cannot report.
let generation = 0;

/** Uppercases and strips spaces and dashes; null unless exactly six symbols of the code alphabet remain. */
export function normalizeCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== Wire.CODE_LENGTH) return null;
  return [...code].every((c) => Wire.CODE_ALPHABET.includes(c)) ? code : null;
}

/** The `?join=<code>&k=<scanKey>` link in `search`; null when it has none or the relay is off. */
export function pendingJoinFromUrl(search: string): State.PendingJoin | null {
  if (Relay.remoteRelayBase() === null) return null;
  const params = new URLSearchParams(search);
  const code = normalizeCode(params.get('join') ?? '');
  if (code === null) return null;
  const key = params.get('k');
  return { code, scanKey: key && key.length <= 128 ? key : null };
}

export function hasResumeToken(): boolean {
  return Store.readStore().resume !== undefined;
}

function dispose(a: Attempt): void {
  if (attempt === a) attempt = null;
  if (a.offerTimer !== null) { clearTimeout(a.offerTimer); a.offerTimer = null; }
  a.abort.abort();
  a.socket?.close();
  a.pc?.close();
}

function fail(a: Attempt, reason: State.JoinFailure): void {
  if (attempt !== a) return;
  dispose(a);
  State.setJoinState({ phase: 'failed', reason });
}

function awaitOffer(a: Attempt): void {
  State.setJoinState({ phase: 'allowed' });
  if (a.offerTimer === null) a.offerTimer = setTimeout(() => { fail(a, 'timeout'); }, OFFER_TIMEOUT_MS);
}

async function answerOffer(a: Attempt, offer: Wire.Sdp): Promise<void> {
  if (a.offerTimer !== null) { clearTimeout(a.offerTimer); a.offerTimer = null; }
  const gen = generation;
  let channel: FrameChannel;
  try {
    const join = await Manual.createAnswer(JSON.stringify(offer));
    a.pc = join.pc;
    if (attempt !== a) { join.pc.close(); return; }
    a.socket?.send({ t: 'sdp', sdp: JSON.parse(join.answer) as Wire.Sdp });
    const dc = await withTimeout(join.channel, CHANNEL_TIMEOUT_MS, 'the data channel', a.abort.signal);
    channel = Peer.wrapDataChannel(join.pc, dc);
    await withTimeout(Peer.whenOpen(dc), CHANNEL_TIMEOUT_MS, 'the data channel', a.abort.signal);
    if (attempt !== a) { channel.close(); return; }
  } catch (err) {
    if (attempt === a) Log.error('remote', 'join handshake failed', err);
    fail(a, 'failed');
    return;
  }
  // The tunnel is direct from here; the relay is only needed to start over.
  a.socket?.close();
  a.socket = null;
  attempt = null;
  try {
    await joinRemote(channel, HOST_LABEL);
  } catch {
    if (gen === generation) State.setJoinState({ phase: 'failed', reason: 'failed' });
    return;
  }
  if (gen !== generation) return;
  State.setJoinState({ phase: 'joined' });
  // The joined device is gone once its tunnel closes.
  channel.onClose(() => {
    if (gen === generation) State.setJoinState({ phase: 'failed', reason: 'host-gone' });
  });
}

function onMessage(a: Attempt, msg: Wire.ServerMessage): void {
  if (attempt !== a) return;
  switch (msg.t) {
    case 'joined':
      if (msg.resumeToken) Store.writeStore({ resume: msg.resumeToken });
      if (msg.needsAllow) State.setJoinState({ phase: 'waiting-allow' });
      else awaitOffer(a);
      return;
    case 'allowed':
      Store.writeStore({ resume: msg.resumeToken });
      awaitOffer(a);
      return;
    case 'denied':
      // Declined at the Allow: the token never works. A refusal after Allow keeps it.
      if (State.joinState().phase === 'waiting-allow') Store.writeStore({ resume: undefined });
      fail(a, 'denied');
      return;
    case 'host-gone':
      Store.writeStore({ resume: undefined });
      fail(a, 'host-gone');
      return;
    case 'error':
      // A refused resume token will not work later either.
      if (a.resumed && (msg.code === 'bad-code' || msg.code === 'no-host')) Store.writeStore({ resume: undefined });
      fail(a, msg.code);
      return;
    case 'sdp':
      if (State.joinState().phase === 'allowed' && msg.sdp.type === 'offer') void answerOffer(a, msg.sdp);
      return;
    default:
      return;
  }
}

// The relay says why it closed a guest socket it did not announce.
function closeFailure(reason: string): State.JoinFailure {
  if (reason === 'replaced') return 'replaced';
  if (reason === 'protocol') return 'violation';
  return 'host-gone';
}

function start(url: string, first: Wire.ClientMessage, resumed: boolean): void {
  leaveJoin();
  generation++;
  const a: Attempt = { socket: null, resumed, pc: null, offerTimer: null, abort: new AbortController() };
  attempt = a;
  State.setJoinState({ phase: 'connecting' });
  a.socket = Signaling.openRoomSocket(url, first, {
    onMessage: (msg) => { onMessage(a, msg); },
    onClose: (opened, reason) => { fail(a, opened ? closeFailure(reason) : 'unreachable'); },
  });
}

/** Joins the room behind a typed code (or a scanned link's code plus key). */
export function joinByCode(input: string, scanKey: string | null = null): void {
  const base = Relay.remoteRelayBase();
  if (base === null) return;
  const code = normalizeCode(input);
  if (code === null) {
    State.setJoinState({ phase: 'failed', reason: 'bad-code' });
    return;
  }
  const label = Identity.peerLabel();
  start(Relay.codeSocketUrl(base, code), scanKey ? { t: 'join', code, scanKey, label } : { t: 'join', code, label }, false);
}

/** Comes back to the room of the stored resume token. */
export function joinWithResume(): void {
  const base = Relay.remoteRelayBase();
  if (base === null) return;
  const token = Store.readStore().resume;
  const url = token ? Relay.resumeSocketUrl(base, token) : null;
  if (!token || !url) {
    State.setJoinState({ phase: 'failed', reason: 'no-token' });
    return;
  }
  start(url, { t: 'join', resume: token, label: Identity.peerLabel() }, true);
}

/** Abandons a join in progress. An already joined device is left alone. */
export function leaveJoin(): void {
  if (attempt) dispose(attempt);
  if (State.joinState().phase === 'joined') return;
  generation++;
  State.setJoinState({ phase: 'idle' });
}
