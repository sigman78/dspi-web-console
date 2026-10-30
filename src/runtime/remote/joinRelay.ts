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
import * as Share from './share';
import * as Store from './relayStore';
import * as Signaling from './signaling';
import { JOIN_FAILURE_TEXT } from './joinFailureText';
import type { FrameChannel } from '@/transport/remote/FrameChannel';
import * as Wire from './relayWire';
import { withTimeout } from './timeout';

// The owner may sit in a pending-changes prompt before offering.
const OFFER_TIMEOUT_MS = 60_000;
const CHANNEL_TIMEOUT_MS = 30_000;
// An automatic reconnect must not leave an Allow prompt waiting on the host for long.
const BOOT_ALLOW_TIMEOUT_MS = 60_000;

// What the owner's console is called here; the relay carries no label for it.
const HOST_LABEL = 'Host console';

interface Attempt {
  socket: Signaling.RoomSocket | null;
  resumed: boolean;
  // Started by the page itself after a reload, not by the user.
  boot: boolean;
  // The token this attempt resumes with, and the one the relay issued for it.
  usedToken: string | null;
  token: string | null;
  // What the console is called in notices.
  name: string;
  pc: RTCPeerConnection | null;
  offerTimer: ReturnType<typeof setTimeout> | null;
  allowTimer: ReturnType<typeof setTimeout> | null;
  // Stops the handshake's waits when the attempt ends.
  abort: AbortController;
}

let attempt: Attempt | null = null;
// The session currently joined, apart from whichever attempt is running. It is
// live only while its device record exists.
let joinedSession: { token: number; id: State.ConnId } | null = null;
let sessionSeq = 0;
// A page being unloaded closes its tunnels too; that must not look like the end of the session.
let unloading = false;
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { unloading = true; });
  window.addEventListener('pageshow', () => { unloading = false; });
}
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

/** What a stored resume token leads to (the console's serial once known); null without a token. */
export function resumeTarget(): string | null {
  const { resume, resumeName } = Store.readStore();
  return resume === undefined ? null : (resumeName ?? 'last console');
}

/** Hands the `?join=` link seen at boot to the caller and removes it from the address bar. */
export function takePendingJoin(): State.PendingJoin | null {
  const pending = State.pendingJoin();
  if (pending === null) return null;
  State.setPendingJoin(null);
  // Other flags (`?mock`) keep their exact spelling, which URLSearchParams would rewrite.
  const rest = location.search.replace(/^\?/, '').split('&').filter((p) => p !== '' && !/^(join|k)(=|$)/.test(p));
  history.replaceState(history.state, '', `${location.pathname}${rest.length ? `?${rest.join('&')}` : ''}${location.hash}`);
  return pending;
}

function hasJoinedSession(): boolean {
  return joinedSession !== null && State.recordOf(joinedSession.id) !== null;
}

// An attempt of the user's or the page's own came to nothing: a reload must
// not retry it. A joined device is not touched by that.
function endAutoRejoin(): void {
  if (!unloading && !hasJoinedSession()) Store.writeAutoRejoin(null);
}

function dispose(a: Attempt): void {
  if (attempt === a) attempt = null;
  if (a.offerTimer !== null) { clearTimeout(a.offerTimer); a.offerTimer = null; }
  if (a.allowTimer !== null) { clearTimeout(a.allowTimer); a.allowTimer = null; }
  a.abort.abort();
  a.socket?.close();
  a.pc?.close();
}

function fail(a: Attempt, reason: State.JoinFailure): void {
  if (attempt !== a) return;
  dispose(a);
  if (a.resumed) endAutoRejoin();
  if (a.boot) announceBootFailure(a.name, reason);
  State.setJoinState({ phase: 'failed', reason });
}

function announceBootFailure(name: string, reason: State.JoinFailure): void {
  State.pushNotice('warn', `Couldn't reconnect to ${name}: ${JOIN_FAILURE_TEXT[reason]}`);
}

function awaitOffer(a: Attempt): void {
  State.setJoinState({ phase: 'allowed' });
  if (a.offerTimer === null) a.offerTimer = setTimeout(() => { fail(a, 'timeout'); }, OFFER_TIMEOUT_MS);
}

async function answerOffer(a: Attempt, offer: Wire.Sdp): Promise<void> {
  if (a.offerTimer !== null) { clearTimeout(a.offerTimer); a.offerTimer = null; }
  const gen = generation;
  let channel: FrameChannel;
  // Past this point a failure to open the channel means the two ends cannot reach each other.
  let answered = false;
  // Aborted when this attempt fails, so a half-built peer connection is closed.
  const setup = new AbortController();
  try {
    const join = await withTimeout(Manual.createAnswer(JSON.stringify(offer), setup.signal), CHANNEL_TIMEOUT_MS, 'the answer', a.abort.signal);
    a.pc = join.pc;
    if (attempt !== a) { join.pc.close(); return; }
    a.socket?.send({ t: 'sdp', sdp: JSON.parse(join.answer) as Wire.Sdp });
    answered = true;
    const dc = await withTimeout(join.channel, CHANNEL_TIMEOUT_MS, 'the data channel', a.abort.signal);
    channel = Peer.wrapDataChannel(join.pc, dc);
    await withTimeout(Peer.whenOpen(dc), CHANNEL_TIMEOUT_MS, 'the data channel', a.abort.signal);
    if (attempt !== a) { channel.close(); return; }
  } catch (err) {
    setup.abort();
    if (attempt === a) Log.error('remote', 'join handshake failed', err);
    if (answered && attempt === a) {
      // Lets the host tell a network problem from a joiner that merely left.
      a.socket?.send({ t: 'bye', reason: 'no-path' });
      fail(a, 'no-path');
    } else {
      fail(a, 'failed');
    }
    return;
  }
  // The tunnel is direct from here; the relay is only needed to start over.
  a.socket?.close();
  a.socket = null;
  attempt = null;
  let id: State.ConnId;
  try {
    id = await joinRemote(channel, HOST_LABEL, a.boot ? { activate: false } : {});
  } catch {
    if (gen === generation) {
      if (a.resumed) endAutoRejoin();
      if (a.boot) announceBootFailure(a.name, 'failed');
      State.setJoinState({ phase: 'failed', reason: 'failed' });
    }
    return;
  }
  Store.writeStore({ resumeName: State.recordOf(id)?.session.info.serial });
  if (gen !== generation) return;
  const mine = { token: ++sessionSeq, id };
  joinedSession = mine;
  if (a.token !== null) Store.writeAutoRejoin({ resume: a.token, name: State.recordOf(id)?.session.info.serial });
  State.setJoinState({ phase: 'joined' });
  // The joined device is gone once its tunnel closes, however that came about.
  channel.onClose(() => {
    if (joinedSession?.token !== mine.token) return;
    joinedSession = null;
    if (!unloading) Store.writeAutoRejoin(null);
    if (gen === generation) State.setJoinState({ phase: 'failed', reason: 'host-gone' });
  });
}

function onMessage(a: Attempt, msg: Wire.ServerMessage): void {
  if (attempt !== a) return;
  switch (msg.t) {
    case 'joined':
      if (msg.resumeToken) { a.token = msg.resumeToken; Store.writeStore({ resume: msg.resumeToken, resumeName: undefined }); }
      if (msg.needsAllow) {
        State.setJoinState({ phase: 'waiting-allow' });
        if (a.boot) a.allowTimer = setTimeout(() => { fail(a, 'timeout'); }, BOOT_ALLOW_TIMEOUT_MS);
      } else {
        awaitOffer(a);
      }
      return;
    case 'allowed':
      a.token = msg.resumeToken;
      Store.writeStore({ resume: msg.resumeToken, resumeName: undefined });
      if (a.allowTimer !== null) { clearTimeout(a.allowTimer); a.allowTimer = null; }
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
      if (a.resumed && (msg.code === 'bad-code' || msg.code === 'no-host') && Store.readStore().resume === a.usedToken) {
        Store.writeStore({ resume: undefined });
      }
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

function abandon(): void {
  if (attempt) dispose(attempt);
  if (State.joinState().phase === 'joined') return;
  generation++;
  State.setJoinState({ phase: 'idle' });
}

function start(url: string, first: Wire.ClientMessage, resumed: boolean, boot = false, name = 'the last console'): void {
  abandon();
  // Joining a remote device wins over a share that is only waiting for its device.
  if (State.shareAway() !== null) Share.stopSharing();
  // Joining switches to the remote device, which would strand this console's own room.
  if (State.shareState() !== 'idle') {
    State.setJoinState({ phase: 'failed', reason: 'sharing' });
    return;
  }
  generation++;
  const a: Attempt = { socket: null, resumed, boot, usedToken: first.t === 'join' ? (first.resume ?? null) : null, token: first.t === 'join' ? (first.resume ?? null) : null, name, pc: null, offerTimer: null, allowTimer: null, abort: new AbortController() };
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
  resume(false);
}

function resume(boot: boolean, saved?: Store.Rejoin): void {
  const base = Relay.remoteRelayBase();
  if (base === null) return;
  const token = saved ? saved.resume : Store.readStore().resume;
  const url = token ? Relay.resumeSocketUrl(base, token) : null;
  if (!token || !url) {
    State.setJoinState({ phase: 'failed', reason: 'no-token' });
    return;
  }
  start(url, { t: 'join', resume: token, label: Identity.peerLabel() }, true, boot, saved?.name ?? 'the last console');
}

/** Reconnects at boot to the device joined before the reload; false when there is nothing to come back to. */
export function rejoinOnBoot(): boolean {
  if (Relay.remoteRelayBase() === null || State.pendingJoin() !== null) return false;
  const saved = Store.readAutoRejoin();
  if (!saved) return false;
  State.pushNotice('info', `Reconnecting to ${saved.name ?? 'the last console'}…`);
  resume(true, saved);
  return true;
}

/** Abandons a join in progress. An already joined device is left alone. */
export function leaveJoin(): void {
  if (State.joinState().phase !== 'joined') endAutoRejoin();
  abandon();
}
