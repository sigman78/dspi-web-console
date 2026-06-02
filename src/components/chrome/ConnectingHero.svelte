<script lang="ts">
  import EqSpectrum from './EqSpectrum.svelte';
  import { session, connection } from '@/state';
  import { connectRequested, reportConnectError, webUsbUnsupportedReason, isDeviceHeld } from '@/runtime';

  let busy = $state(false);
  const unsupported = webUsbUnsupportedReason();

  // Mirrors StatusPill.svelte's text/disabled derivation. Kept duplicated
  // (six lines of switch) rather than extracted; the two presentations may
  // diverge and an early shared module would be the wrong abstraction.
  const text = $derived.by(() => {
    if (unsupported) return 'WEBUSB UNAVAILABLE';
    switch (connection.phase) {
      case 'ready':      return `ONLINE · ${session.device?.info.serial ?? ''}`;
      case 'connecting': return 'CONNECTING…';
      case 'errored':    return 'ERROR';
      case 'noDevice':   return 'WAITING FOR DEVICE…';
    }
  });

  const showUnsupportedFirmware = $derived(
    connection.errorKind === 'unsupported-firmware'
  );
  const showErrorPanel = $derived(
    connection.error !== null && !showUnsupportedFirmware
  );

  const disabled = $derived(
    busy || unsupported !== null || connection.phase === 'connecting'
  );

  let heldElsewhere = $state(false);

  async function refreshHeld() {
    heldElsewhere =
      (connection.phase === 'noDevice' || connection.phase === 'errored') &&
      await isDeviceHeld();
  }

  $effect(() => {
    void connection.phase;      // re-check when our own status changes
    void refreshHeld();
    const onFocus = () => { if (document.visibilityState === 'visible') void refreshHeld(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  });

  async function connect() {
    if (disabled) return;
    // 'connected' is intentionally NOT in the disabled predicate (button stays
    // live); the handler still no-ops so a stray click doesn't re-enter connect.
    if (connection.connected) return;
    busy = true;
    try {
      await connectRequested();
    } catch (e) {
      reportConnectError(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="connecting-hero">
  <EqSpectrum />
  <div class="status" class:is-error={connection.phase === 'errored'}>{text}</div>
  {#if unsupported}
    <div class="unsupported-panel warn-panel" role="alert" aria-label="WebUSB unavailable">
      <div class="warn-panel__header">WEBUSB UNAVAILABLE</div>
      <pre class="warn-panel__body">{unsupported}</pre>
    </div>
  {:else}
    {#if showUnsupportedFirmware}
      <div class="warn-panel" role="alert" aria-label="Firmware update required">
        <div class="warn-panel__header">FIRMWARE UPDATE REQUIRED</div>
        <pre class="warn-panel__body">{connection.error}</pre>
      </div>
    {:else if heldElsewhere && !showErrorPanel}
      <div class="held-panel warn-panel" role="status" aria-label="Device in use">
        <div class="warn-panel__header">DEVICE IN USE</div>
        <pre class="warn-panel__body">This device looks like it's open in another browser tab. Close it there, or click CONNECT to try anyway.</pre>
      </div>
    {/if}
    <button
      class="connect"
      onclick={connect}
      disabled={disabled}
      title={text}
    >
      CONNECT
    </button>
    {#if showErrorPanel}
      <div class="error-panel" role="alert" aria-label="Connection error details">
        <div class="error-panel__header">DIAGNOSTICS</div>
        <pre class="error-panel__body">{connection.error}</pre>
      </div>
    {/if}
  {/if}
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
  .status.is-error {
    color: var(--err);
  }
  .error-panel {
    margin-top: 4px;
    width: min(640px, 90vw);
    border: 1px solid color-mix(in oklab, var(--err) 55%, var(--border));
    background: color-mix(in oklab, var(--err) 7%, var(--panel));
    border-radius: var(--radius);
    overflow: hidden;
    text-align: left;
  }
  .error-panel__header {
    padding: 6px 12px;
    font-size: 10px;
    letter-spacing: 2px;
    color: var(--err);
    background: color-mix(in oklab, var(--err) 10%, transparent);
    border-bottom: 1px solid color-mix(in oklab, var(--err) 35%, var(--border));
  }
  .error-panel__body {
    margin: 0;
    padding: 10px 12px;
    max-height: 240px;
    overflow: auto;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.5;
    color: var(--text);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .warn-panel {
    margin-top: 4px;
    width: min(640px, 90vw);
    border: 1px solid color-mix(in oklab, var(--warn) 55%, var(--border));
    background: color-mix(in oklab, var(--warn) 7%, var(--panel));
    border-radius: var(--radius);
    overflow: hidden;
    text-align: left;
  }
  .warn-panel__header {
    padding: 6px 12px;
    font-size: 10px;
    letter-spacing: 2px;
    color: var(--warn);
    background: color-mix(in oklab, var(--warn) 10%, transparent);
    border-bottom: 1px solid color-mix(in oklab, var(--warn) 35%, var(--border));
  }
  .warn-panel__body {
    margin: 0;
    padding: 10px 12px;
    max-height: 240px;
    overflow: auto;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.5;
    color: var(--text);
    white-space: pre-wrap;
    word-break: break-word;
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
