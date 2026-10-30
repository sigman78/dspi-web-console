<script lang="ts">
  import * as State from '@/state';
  import { Log, errMessage } from '@/utils';
  import * as Signaling from '@/runtime/remote/manualSignaling';
  import * as Peer from '@/runtime/remote/peer';
  import * as Lease from '@/runtime/remote/lease';
  import { joinRemote } from '@/runtime/remote/join';
  import * as Relay from '@/runtime/remote/relay';
  import * as Share from '@/runtime/remote/share';
  import * as JoinRelay from '@/runtime/remote/joinRelay';
  import type { FrameChannel } from '@/transport/remote/FrameChannel';

  let offerText = $state('');
  let answerText = $state('');
  let status = $state('idle');
  let host = $state<{ session: Signaling.HostSession; channel: FrameChannel } | null>(null);
  let accepting = false;

  const share = $derived(State.shareState());
  const relayOn = Relay.remoteRelayBase() !== null;
  const room = $derived(State.shareRoom());
  const peer = $derived(State.sharePeer());
  const joining = $derived(State.joinState());
  let codeText = $state('');
  let relayError = $state('');

  async function startRelayShare(): Promise<void> {
    relayError = '';
    try {
      await Share.startSharing();
    } catch (err) {
      relayError = errMessage(err);
    }
  }

  function failed(what: string, err: unknown): void {
    Log.error('remote', `${what} failed`, err);
    status = `${what} failed: ${errMessage(err)}`;
  }

  async function createOffer(): Promise<void> {
    if (State.shareState() === 'lent') { status = 'already lent'; return; }
    try {
      status = 'gathering…';
      host?.session.pc.close();
      const session = await Signaling.createOffer();
      host = { session, channel: Peer.wrapDataChannel(session.pc, session.dc) };
      offerText = session.offer;
      answerText = '';
      State.setShareState('sharing');
      status = 'offer ready: send it to the other console';
    } catch (err) {
      failed('create offer', err);
    }
  }

  // The device is handed over (prompt, flush) before the answer is applied, so
  // no human wait lands inside the peer's handshake window.
  async function acceptAnswer(): Promise<void> {
    if (!host) { status = 'create an offer first'; return; }
    if (accepting) return;
    accepting = true;
    const { session, channel } = host;
    let lend: Lease.LendHandle | null = null;
    try {
      lend = await Lease.prepareLend({ peerLabel: 'Remote console' });
      if (!lend) {
        session.pc.close();
        host = null;
        if (State.shareState() !== 'lent') State.setShareState('idle');
        status = 'not lent';
        return;
      }
      await Signaling.acceptAnswer(session, answerText.trim());
      status = 'connecting…';
      await Peer.whenOpen(session.dc);
      const attached = Lease.attachLend(channel, { watchLiveness: (onLost) => Peer.watchPeerLiveness(session.pc, onLost) });
      host = null;
      status = attached ? 'lent' : 'lend dropped before attach';
    } catch (err) {
      if (lend) Lease.abortLend(lend);
      session.pc.close();
      host = null;
      failed('accept answer', err);
    } finally {
      accepting = false;
    }
  }

  async function createAnswer(): Promise<void> {
    try {
      status = 'gathering…';
      const join = await Signaling.createAnswer(offerText.trim());
      answerText = join.answer;
      status = 'answer ready: send it back, waiting for the channel…';
      const dc = await join.channel;
      const channel = Peer.wrapDataChannel(join.pc, dc);
      await Peer.whenOpen(dc);
      await joinRemote(channel, 'Host console');
      status = 'joined';
    } catch (err) {
      failed('join', err);
    }
  }

  function stopSharing(): void {
    host?.session.pc.close();
    host = null;
    Lease.reclaim('stop');
    State.setShareState('idle');
    status = 'idle';
  }
</script>

<div class="dev">
  <div class="head">REMOTE DEV · {status} · share {share}</div>
  {#if relayOn}
    <div class="head">
      RELAY · {room ? `code ${room.code}` : 'not sharing'}{peer ? ` · ${peer.stage} ${peer.label}` : ''}
      · join {joining.phase}{joining.phase === 'failed' ? ` (${joining.reason})` : ''}{relayError ? ` · ${relayError}` : ''}
    </div>
    <div class="row">
      <button type="button" class="chip" onclick={() => void startRelayShare()}>Share</button>
      <button type="button" class="chip" disabled={peer?.stage !== 'pending'} onclick={Share.allow}>Allow</button>
      <button type="button" class="chip" disabled={peer?.stage !== 'pending'} onclick={Share.deny}>Deny</button>
      <button type="button" class="chip" onclick={Share.stopSharing}>Stop relay</button>
    </div>
    <div class="row">
      <input placeholder="code" spellcheck="false" bind:value={codeText} />
      <button type="button" class="chip" onclick={() => { JoinRelay.joinByCode(codeText); }}>Join</button>
      <button type="button" class="chip" onclick={JoinRelay.joinWithResume}>Reconnect</button>
      <button type="button" class="chip" onclick={JoinRelay.leaveJoin}>Leave</button>
    </div>
  {/if}
  <textarea rows="4" placeholder="offer" spellcheck="false" bind:value={offerText}></textarea>
  <textarea rows="4" placeholder="answer" spellcheck="false" bind:value={answerText}></textarea>
  <div class="row">
    <button type="button" class="chip" onclick={() => void createOffer()}>Host: create offer</button>
    <button type="button" class="chip" onclick={() => void createAnswer()}>Join: paste offer, create answer</button>
    <button type="button" class="chip" onclick={() => void acceptAnswer()}>Host: paste answer</button>
    <button type="button" class="chip" onclick={stopSharing}>Stop</button>
  </div>
</div>

<style>
  .dev {
    position: fixed;
    right: 8px;
    bottom: 8px;
    z-index: var(--z-pop);
    width: 360px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    background: var(--panel-solid);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 11px;
  }
  .head { font-family: var(--font-mono); color: var(--text-dim); overflow-wrap: anywhere; }
  textarea {
    height: 72px;
    resize: none;
    font-family: var(--font-mono);
    font-size: 10px;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
  }
  input { width: 80px; font-family: var(--font-mono); background: var(--bg); color: var(--text); border: 1px solid var(--border); }
  .row { display: flex; flex-wrap: wrap; gap: 6px; }
</style>
