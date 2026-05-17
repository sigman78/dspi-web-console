<!-- src/components/chrome/PresetActiveChip.svelte -->
<script lang="ts">
  import { presets, presetsDirty, setTab, session } from '@/state';

  const active = $derived(presets.active);
  const name = $derived(active == null ? '' : (presets.names[active] ?? ''));
  const connected = $derived(session.status === 'connected');
  const dirty = $derived(presetsDirty.current);

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
