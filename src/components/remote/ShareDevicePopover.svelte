<script lang="ts">
  import { onMount } from 'svelte';
  import * as State from '@/state';
  import * as Share from '@/runtime/remote/share';
  import { dismiss } from '@/components/chrome/dismiss';
  import RemoteIcon from './RemoteIcon.svelte';
  import { formatCode } from './codeInput';

  const { onClose, ignore }: { onClose: () => void; ignore?: string } = $props();

  const room = $derived(State.shareRoom());
  const peer = $derived(State.sharePeer());
  let startError = $state<string | null>(null);
  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  const dead = $derived(room !== null && room.status !== 'live');

  const status = $derived.by(() => {
    if (startError) return startError;
    if (!room) return 'Opening a room…';
    if (peer?.stage === 'connecting') return `Connecting to ${peer.label}…`;
    if (room.status === 'burnt') return 'Code already used. Make a new one for the next console.';
    if (room.status === 'expired') return 'Code expired. Make a new one.';
    return 'Waiting for the other console…';
  });

  onMount(() => {
    if (State.shareState() === 'idle') void open();
    return () => { clearTimeout(copyTimer); };
  });

  async function open(): Promise<void> {
    startError = null;
    try {
      await Share.startSharing();
    } catch (err) {
      startError = err instanceof Error && err.message === 'rate-limited'
        ? 'Too many attempts. Try again in a minute.'
        : 'Could not reach the relay.';
    }
  }

  async function copyLink(): Promise<void> {
    if (!room || dead) return;
    const link = `${location.origin}${import.meta.env.BASE_URL}?join=${room.code}`;
    try {
      await navigator.clipboard.writeText(link);
      copied = true;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => { copied = false; }, 1500);
    } catch {
      // Clipboard unavailable; the code stays readable on screen.
    }
  }

  function stop(): void {
    Share.stopSharing();
    onClose();
  }
</script>

<div class="pop" role="dialog" aria-modal="false" aria-label="Share device" use:dismiss={{ onDismiss: onClose, ignore }}>
  <header>
    <span class="title">SHARE DEVICE</span>
    <button type="button" class="x-btn close" aria-label="Close" onclick={onClose}>✕</button>
  </header>
  <div class="body">
    <div class="codeline">
      <span class="code" class:dead aria-label="Pairing code">{room ? formatCode(room.code) : '------'}</span>
      <button type="button" class="icon-toggle" disabled={!room || dead} aria-label="Copy invite link" title={copied ? 'Copied' : 'Copy invite link'} onclick={() => void copyLink()}>
        <RemoteIcon icon={copied ? 'check' : 'copy'} />
      </button>
      <button type="button" class="icon-toggle" class:accent={dead} disabled={!room || peer !== null} aria-label="New code" title="New code" onclick={Share.rotateCode}>
        <RemoteIcon icon="rotate" />
      </button>
    </div>
    <div class="statusline" role="status">
      {#if peer?.stage === 'pending'}
        <span class="msg"><b>{peer.label}</b> wants control</span>
        <button type="button" class="icon-toggle accent" aria-label="Allow" title="Allow" onclick={Share.allow}><RemoteIcon icon="check" /></button>
        <button type="button" class="icon-toggle deny" aria-label="Deny" title="Deny" onclick={Share.deny}><RemoteIcon icon="close" /></button>
      {:else}
        <span class="msg" class:bad={startError !== null}>{status}</span>
        {#if startError}
          <button type="button" class="icon-toggle" aria-label="Try again" title="Try again" onclick={() => void open()}><RemoteIcon icon="rotate" /></button>
        {/if}
      {/if}
    </div>
    <div class="foot">
      <button type="button" class="chip danger" disabled={!room} onclick={stop}>STOP SHARING</button>
    </div>
  </div>
</div>

<style>
  .pop {
    width: 264px;
    box-sizing: border-box;
    background: var(--panel-solid);
    border: 1px solid var(--border-hi);
    border-radius: var(--radius-m);
    box-shadow: var(--shadow-flyout);
    font-size: var(--fs-m);
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
  .codeline { display: flex; align-items: center; gap: 6px; }
  .code {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 26px;
    letter-spacing: 3px;
    color: var(--text);
  }
  .code.dead { opacity: var(--dim-off); text-decoration: line-through; }
  .statusline { display: flex; align-items: center; gap: 6px; min-height: var(--h-ctl); color: var(--text-dim); }
  .msg { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .msg b { color: var(--text); font-weight: 600; }
  .msg.bad { color: var(--err); }
  .icon-toggle.deny { color: var(--err); }
  .foot { display: flex; justify-content: flex-end; }
</style>
