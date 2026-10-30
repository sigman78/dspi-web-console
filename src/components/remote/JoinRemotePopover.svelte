<script lang="ts">
  import * as State from '@/state';
  import * as JoinRelay from '@/runtime/remote/joinRelay';
  import { dismiss } from '@/components/chrome/dismiss';
  import CodeField from './CodeField.svelte';
  import RemoteIcon from './RemoteIcon.svelte';

  const { seed = null, onClose, ignore }: { seed?: State.PendingJoin | null; onClose: () => void; ignore?: string } = $props();

  // svelte-ignore state_referenced_locally
  let code = $state(seed?.code ?? '');
  const LIVE = ['connecting', 'waiting-allow', 'allowed'];
  // Status follows an attempt made from here, including one still running from before a close.
  let attempted = $state(LIVE.includes(State.joinState().phase));

  const join = $derived(State.joinState());
  const busy = $derived(attempted && LIVE.includes(join.phase));
  const resume = $derived.by(() => {
    // The token store is not reactive; a join attempt is what changes it.
    void State.joinState();
    return JoinRelay.resumeTarget();
  });

  const FAILURE_TEXT: Record<State.JoinFailure, string> = {
    'bad-code': 'That code is not valid.',
    'burnt': 'That code was already used. Ask for a new one.',
    'expired': 'That code has expired. Ask for a new one.',
    'rate-limited': 'Too many attempts. Try again in a minute.',
    'no-host': 'The other console is no longer sharing.',
    'busy': 'The device is in use by another console.',
    'denied': 'The other console declined.',
    'host-gone': 'The other console stopped sharing.',
    'replaced': 'Connected from another tab.',
    'violation': 'The relay rejected the request.',
    'unreachable': 'Could not reach the relay.',
    'timeout': 'The other console did not respond.',
    'no-token': 'Nothing to reconnect to.',
    'failed': 'Could not connect.',
  };

  const status = $derived.by(() => {
    if (!attempted) return null;
    switch (join.phase) {
      case 'connecting': return { text: 'Connecting…', bad: false };
      case 'waiting-allow': return { text: 'Waiting for Allow on the other console…', bad: false };
      case 'allowed': return { text: 'Allowed. Connecting…', bad: false };
      case 'failed': return { text: FAILURE_TEXT[join.reason], bad: true };
      default: return null;
    }
  });

  // The joined device shows up in the switcher; nothing more to ask here.
  $effect(() => {
    if (attempted && join.phase === 'joined') onClose();
  });

  function connect(): void {
    if (busy || code.length < 6) return;
    attempted = true;
    JoinRelay.joinByCode(code, seed && seed.code === code ? seed.scanKey : null);
  }

  function reconnect(): void {
    if (busy) return;
    attempted = true;
    JoinRelay.joinWithResume();
  }
</script>

<div class="pop" role="dialog" aria-modal="false" aria-label="Connect to a remote device" use:dismiss={{ onDismiss: onClose, ignore }}>
  <header>
    <span class="title">CONNECT TO REMOTE</span>
    <button type="button" class="x-btn close" aria-label="Close" onclick={onClose}>✕</button>
  </header>
  <div class="body">
    <span class="microlbl">CODE FROM THE OTHER CONSOLE</span>
    <div class="entry">
      <CodeField value={code} onChange={(next) => { code = next; }} disabled={busy} onSubmit={connect} />
      {#if busy}
        <button type="button" class="chip md" onclick={JoinRelay.leaveJoin}>CANCEL</button>
      {:else}
        <button type="button" class="chip accent md" disabled={code.length < 6} onclick={connect}>CONNECT</button>
      {/if}
    </div>
    {#if status}
      <div class="status" class:bad={status.bad} role="status">{status.text}</div>
    {/if}
    {#if resume !== null}
      <button type="button" class="reconnect" disabled={busy} onclick={reconnect}>
        <RemoteIcon icon="link" />
        <span>Reconnect to {resume}</span>
      </button>
    {/if}
  </div>
</div>

<style>
  .pop {
    width: 320px;
    max-width: 100%;
    box-sizing: border-box;
    background: var(--panel-solid);
    border: 1px solid var(--border-hi);
    border-radius: var(--radius-m);
    box-shadow: var(--shadow-flyout);
    font-size: var(--fs-m);
    text-align: left;
  }
  header {
    height: var(--h-head);
    box-sizing: border-box;
    display: flex;
    align-items: center;
    padding: 0 6px 0 12px;
    border-bottom: 1px solid var(--border);
  }
  .title { font-family: var(--font-sans); font-size: var(--fs-m); font-weight: 600; letter-spacing: 0.5px; }
  .x-btn { margin-left: auto; }
  .body { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; }
  .entry { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .status { color: var(--text-dim); overflow-wrap: anywhere; }
  .status.bad { color: var(--err); }
  .reconnect {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0;
    background: none;
    border: none;
    font: inherit;
    color: var(--text-dim);
    cursor: pointer;
  }
  .reconnect:hover:not(:disabled) { color: var(--accent); }
  .reconnect:disabled { opacity: var(--dim-disabled); cursor: default; }
</style>
