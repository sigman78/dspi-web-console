<script lang="ts">
  import EqSpectrum from './EqSpectrum.svelte';
  import { session, setStatus } from '../../state/session.svelte';
  import { connectRequested, webUsbUnsupportedReason } from '../../runtime/session';

  let busy = $state(false);
  const unsupported = webUsbUnsupportedReason();

  // Mirrors StatusPill.svelte's text/disabled derivation. Kept duplicated
  // (six lines of switch) rather than extracted; the two presentations may
  // diverge and an early shared module would be the wrong abstraction.
  const text = $derived.by(() => {
    if (unsupported) return 'WEBUSB UNAVAILABLE';
    switch (session.status) {
      case 'connected':    return `ONLINE · ${session.identity.serial}`;
      case 'connecting':   return 'CONNECTING…';
      case 'disconnected': return 'DISCONNECTED';
      case 'error':        return `ERROR · ${session.error ?? ''}`;
      case 'idle':         return 'WAITING FOR DEVICE...';
    }
  });

  const disabled = $derived(
    busy || unsupported !== null || session.status === 'connecting'
  );

  async function connect() {
    if (disabled) return;
    // 'connected' is intentionally NOT in the disabled predicate (button stays
    // live); the handler still no-ops so a stray click doesn't re-enter connect.
    if (session.status === 'connected') return;
    busy = true;
    try {
      await connectRequested();
    } catch (e) {
      setStatus('error', (e as Error).message);
    } finally {
      busy = false;
    }
  }
</script>

<div class="connecting-hero">
  <EqSpectrum />
  <div class="status">{text}</div>
  <button
    class="connect"
    onclick={connect}
    disabled={disabled}
    title={unsupported ?? text}
  >
    CONNECT
  </button>
</div>

<style>
  .connecting-hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    font-family: var(--font-mono);
  }
  .status {
    font-size: 11px;
    letter-spacing: 2px;
    color: var(--accent);
  }
  .connect {
    padding: 10px 26px;
    background: color-mix(in oklab, var(--accent) 12%, transparent);
    border: 1px solid var(--accent);
    color: var(--accent);
    font-family: inherit;
    font-size: 12px;
    letter-spacing: 2px;
    border-radius: 4px;
    cursor: pointer;
  }
  .connect:hover:not(:disabled) {
    background: color-mix(in oklab, var(--accent) 20%, transparent);
  }
  .connect:disabled {
    cursor: default;
    opacity: 0.55;
  }
</style>
