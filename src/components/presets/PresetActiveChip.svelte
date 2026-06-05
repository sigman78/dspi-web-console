<script lang="ts">
  import { presetsDirty, setTab, connection, activeSession } from '@/state';

  const s = $derived(activeSession());
  const active = $derived(s?.presets.active);
  const name = $derived(active == null ? '' : (s?.presets.names[active] ?? ''));
  const connected = $derived(connection.connected);
  const dirty = $derived(s ? presetsDirty(s) : false);

  function onclick() {
    if (!connected) return;
    setTab('presets');
  }
</script>

<button
  class="chip"
  class:dim={!connected}
  class:dirty
  onclick={onclick}
  disabled={!connected}
  title={dirty ? 'Active preset · unsaved changes' : 'Active preset'}
>
  {#if active != null}
    <span class="num">{String(active).padStart(2, '0')}</span>
    <span class="name">{name.length ? name : '[unnamed]'}</span>
  {:else}
    <span class="num">—</span>
  {/if}
</button>

<style>
  .chip {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 10px;
    border-radius: 4px;
    font-family: var(--font-mono); font-size: 10px; letter-spacing: 1px;
    background: color-mix(in oklab, var(--text) 4%, transparent);
    border: 1px solid var(--border);
    color: var(--text-dim);
    cursor: pointer;
  }
  .chip:hover:not(:disabled) { color: var(--text); border-color: var(--border-hi); }
  .chip:disabled { cursor: default; opacity: 0.5; }
  .chip.dim { opacity: 0.5; }
  .chip.dirty {
    border-color: color-mix(in oklab, var(--accent) 45%, transparent);
    color: var(--accent);
  }
  .num { font-size: 9px; color: var(--text-faint); }
  .chip.dirty .num { color: color-mix(in oklab, var(--accent) 70%, transparent); }
  .name { max-width: 14ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
