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
    display: flex; align-items: center; gap: 6px;
    width: 100%;
    padding: 6px 8px;
    border-radius: 4px;
    font-family: var(--font-mono); font-size: 10px; letter-spacing: 1px;
    background: var(--wash);
    border: 1px solid var(--border);
    color: var(--text-dim);
    cursor: pointer;
  }
  .chip:hover:not(:disabled) { color: var(--text); border-color: var(--border-hi); }
  /* :disabled and .dim fire together (both driven by !connected) -- same
     single dim layer via the token, not a stack; .dim covers the icon/text
     inside that isn't itself a disabled form control. */
  .chip:disabled { cursor: default; opacity: var(--dim-disabled); }
  .chip.dim { opacity: var(--dim-disabled); }
  .chip.dirty {
    border-color: color-mix(in oklab, var(--accent) 45%, transparent);
    color: var(--accent);
  }
  .num { font-size: 9px; color: var(--text-faint); }
  .chip.dirty .num { color: color-mix(in oklab, var(--accent) 70%, transparent); }
  .name { max-width: 14ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
