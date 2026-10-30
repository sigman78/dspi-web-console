<script lang="ts">
  import * as State from '@/state';
  import { Log, errMessage } from '@/utils';
  import * as Signaling from '@/runtime/remote/manualSignaling';
  import * as Peer from '@/runtime/remote/peer';
  import * as Lease from '@/runtime/remote/lease';
  import { joinRemote } from '@/runtime/remote/join';
  import type { FrameChannel } from '@/transport/remote/FrameChannel';

  let offerText = $state('');
  let answerText = $state('');
  let status = $state('idle');
  let host = $state<{ session: Signaling.HostSession; channel: FrameChannel } | null>(null);
  let accepting = false;

  const share = $derived(State.shareState());

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
    try {
      if (!(await Lease.prepareLend({ peerLabel: 'Remote console' }))) {
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
      Lease.abortLend();
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
  .row { display: flex; flex-wrap: wrap; gap: 6px; }
</style>
