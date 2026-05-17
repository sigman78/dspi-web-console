<script lang="ts">
  import { session, setStatus, presetsDirty } from '@/state';
  import { connectRequested, webUsbUnsupportedReason } from '@/runtime';

  let busy = $state(false);
  const unsupported = webUsbUnsupportedReason();

  async function connect() {
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

  const text = $derived.by(() => {
    if (unsupported) return 'WEBUSB UNAVAILABLE';
    switch (session.status) {
      case 'connected':    return 'ONLINE';
      case 'connecting':   return 'CONNECTING…';
      case 'disconnected': return 'DISCONNECTED';
      case 'error':        return `ERROR · ${session.error ?? ''}`;
      case 'idle':         return 'CLICK TO CONNECT';
    }
  });

  const tone = $derived.by(() => {
    if (unsupported || session.status === 'error') return 'err';
    if (session.status === 'connected') return 'ok';
    if (session.status === 'connecting') return 'warn';
    return 'idle';
  });
</script>

<button
  class="pill {tone}"
  onclick={connect}
  disabled={busy || unsupported !== null || session.status === 'connected'}
  title={unsupported ?? (presetsDirty.current && session.status === 'connected' ? `${text} · unsaved changes` : text)}
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
