<script lang="ts">
  import { connection, presetsDirty, activeSession } from '@/state';
  import { connectRequested, webUsbUnsupportedReason } from '@/runtime';
  import { chromeConnectionStatus } from './connectionStatus';

  const s = $derived(activeSession());
  let busy = $state(false);
  const unsupported = webUsbUnsupportedReason();

  async function connect() {
    if (connection.connected) return;
    busy = true;
    try {
      await connectRequested();
    } catch {
      // connectRequested already reported the failure with its errorKind.
    } finally {
      busy = false;
    }
  }

  const degraded = $derived(connection.connected && (s?.health.degraded ?? false));

  const text = $derived.by(() => {
    if (unsupported) return 'WEBUSB UNAVAILABLE';
    switch (connection.phase) {
      case 'ready':      return degraded ? 'LINK UNSTABLE' : 'ONLINE';
      case 'connecting': return 'CONNECTING…';
      // Keep the pill text fixed-width: the (possibly long) message lives in
      // the hover tooltip and the browser console, never in the bar itself.
      case 'errored':    return 'ERROR';
      case 'noDevice':   return 'CLICK TO CONNECT';
    }
  });

  const tone = $derived(
    chromeConnectionStatus({
      phase: connection.phase,
      connected: connection.connected,
      degraded,
      unsupported: unsupported !== null,
    }).tone
  );
</script>

<button
  class="pill {tone}"
  onclick={connect}
  disabled={busy || unsupported !== null || connection.connected || connection.phase === 'connecting'}
  title={unsupported ??
    (connection.phase === 'errored'
      ? `ERROR · ${connection.error ?? ''}`
      : degraded
        ? `LINK UNSTABLE · ${s?.health.lastErrorOp ?? ''}: ${s?.health.lastErrorMsg ?? ''}`
        : (s ? presetsDirty(s) : false) && connection.connected
          ? `${text} · unsaved changes`
          : text)}
>
  <span class="dot"></span>
  {text}
</button>

<style>
  .pill {
    padding: 4px 10px;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 1px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    color: var(--text-dim);
    background: color-mix(in oklab, var(--text) 4%, transparent);
    border: 1px solid var(--border);
  }
  .pill:disabled { cursor: default; }
  .pill.ok {
    background: color-mix(in oklab, var(--ok) 10%, transparent);
    border-color: color-mix(in oklab, var(--ok) 40%, transparent);
    color: color-mix(in oklab, var(--ok), white 25%);
  }
  .pill.warn {
    background: color-mix(in oklab, var(--warn) 10%, transparent);
    border-color: color-mix(in oklab, var(--warn) 40%, transparent);
    color: var(--warn);
  }
  .pill.err {
    background: color-mix(in oklab, var(--err) 10%, transparent);
    border-color: color-mix(in oklab, var(--err) 40%, transparent);
    color: var(--err);
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    box-shadow: 0 0 8px currentColor;
  }
</style>
