<script lang="ts">
  import { connection, activeSession } from '@/state';
  import { setUserVolume, setUserMute } from '@/runtime';

  const s = $derived(activeSession());
  const connected = $derived(connection.connected);
  const uv = $derived(s?.mirror.current?.userVolume ?? null);
  const volumeDb = $derived(uv?.volumeDb ?? 0);
  const muted = $derived(uv?.mute ?? false);

  function onChange(e: Event) {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (!Number.isNaN(v) && s) setUserVolume(s, v);
  }
</script>

<div class="vol" class:dim={!connected || uv === null}>
  <span class="lbl">USB VOL</span>
  <input
    type="range"
    class:muted
    min="-60" max="0" step="0.5"
    value={volumeDb}
    oninput={onChange}
    disabled={!connected || uv === null}
    aria-label="USB host volume"
  />
  <span class="db" class:muted>
    {connected && uv ? (muted ? 'MUTED' : `${volumeDb.toFixed(1)}`) : '—'}
  </span>
  <button
    class="mute"
    class:on={muted}
    onclick={() => { if (s) setUserMute(s, !muted); }}
    disabled={!connected || uv === null}
    title={muted ? 'Unmute USB volume' : 'Mute USB volume'}
    aria-label={muted ? 'Unmute USB volume' : 'Mute USB volume'}
  >
    {#if muted}
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6h2l3-3v10l-3-3H3z" fill="currentColor" />
        <line x1="11" y1="6" x2="14" y2="9" />
        <line x1="14" y1="6" x2="11" y2="9" />
      </svg>
    {:else}
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6h2l3-3v10l-3-3H3z" fill="currentColor" />
        <path d="M11 5.5a3 3 0 0 1 0 5" />
      </svg>
    {/if}
  </button>
</div>

<style>
  .vol {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-dim);
  }
  .vol.dim { opacity: 0.5; }
  .lbl { font-size: 9px; color: var(--text-faint); letter-spacing: 1px; }
  input[type="range"] {
    width: 90px;
    accent-color: var(--accent);
    margin: 0;
    padding: 0;
  }
  input[type="range"].muted {
    accent-color: var(--text-faint);
    opacity: 0.45;
  }
  .db {
    font-size: 11px;
    color: var(--text);
    font-weight: 600;
    min-width: 40px;
    text-align: right;
  }
  .db.muted { color: var(--text-faint); letter-spacing: 0.5px; }
  .mute {
    width: 24px;
    height: 22px;
    padding: 0;
    border-radius: 4px;
    background: color-mix(in oklab, var(--text) 4%, transparent);
    border: 1px solid var(--border);
    color: var(--text-dim);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .mute:hover:not(:disabled) { color: var(--text); border-color: var(--border-hi); }
  .mute:disabled { cursor: default; opacity: 0.5; }
  .mute.on {
    background: color-mix(in oklab, var(--err) 15%, transparent);
    border-color: color-mix(in oklab, var(--err) 45%, transparent);
    color: var(--err);
  }
</style>
