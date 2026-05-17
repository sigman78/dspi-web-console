<script lang="ts">
  import Panel from '../chrome/Panel.svelte';
  import { dsp, session } from '../../state';
  import { setChannelName } from '../../runtime/actions';
  import { CHANNEL_NAME_MAX_LEN, type ChannelId } from '../../domain';
  import { chKey } from '../../styles/palette';

  const channels = $derived(dsp.live?.channels ?? []);
  const connected = $derived(session.status === 'connected');

  let editingId: ChannelId | null = $state(null);
  let pendingValue = $state('');
  let originalValue = '';

  function startEdit(id: ChannelId, currentName: string): void {
    if (!connected) return;
    editingId = id;
    pendingValue = currentName;
    originalValue = currentName;
  }

  function commit(id: ChannelId): void {
    // Guard re-entry: Enter/Escape unmount the input, which then fires blur.
    if (editingId !== id) return;
    if (pendingValue !== originalValue) {
      setChannelName(id, pendingValue);
    }
    editingId = null;
  }

  function cancel(): void {
    editingId = null;
    pendingValue = '';
  }

  function onKeydown(e: KeyboardEvent, id: ChannelId): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  }
</script>

<Panel code="SY.06" title="CHANNEL NAMES">
  {#snippet right()}
    <span class="hint">until next preset save</span>
  {/snippet}

  <div class="rows">
    {#each channels as ch (ch.id)}
      <div class="row ch-{chKey(ch.id)}">
        <span class="lbl">{ch.shortName}</span>
        {#if editingId === ch.id}
          <input
            type="text"
            class="name-input"
            bind:value={pendingValue}
            placeholder={ch.defaultName}
            spellcheck="false"
            autocomplete="off"
            maxlength={CHANNEL_NAME_MAX_LEN}
            onkeydown={(e) => onKeydown(e, ch.id)}
            onblur={() => commit(ch.id)}
            aria-label={`Rename ${ch.shortName}`}
          />
        {:else}
          <button
            type="button"
            class="name"
            class:is-default={ch.name === ch.defaultName}
            onclick={() => startEdit(ch.id, ch.name)}
            disabled={!connected}
            aria-label={`Edit ${ch.shortName} name (currently ${ch.name})`}
          >
            {ch.name}
          </button>
        {/if}
      </div>
    {/each}
  </div>
</Panel>

<style>
  .rows {
    padding: 14px;
    display: grid;
    gap: 6px;
  }
  .row {
    display: grid;
    grid-template-columns: 2.5rem 1fr;
    gap: 0.5rem;
    align-items: center;
    font-size: 0.8rem;
  }
  .lbl {
    font-weight: 600;
    font-family: var(--font-mono);
    color: var(--ch-base);
  }
  .name {
    text-align: left;
    background: transparent;
    border: none;
    border-radius: 0;
    color: var(--text);
    font: inherit;
    padding: 4px 8px;
    box-shadow: inset 0 -1px 0 0 color-mix(in oklab, var(--text) 14%, transparent);
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: background 80ms, box-shadow 80ms;
  }
  .name:hover:not(:disabled) {
    background: color-mix(in oklab, var(--text) 4%, transparent);
    box-shadow:
      inset 0 -1px 0 0 color-mix(in oklab, var(--text) 32%, transparent),
      0 -2px 6px -2px color-mix(in oklab, var(--text) 18%, transparent) inset;
  }
  .name:disabled {
    cursor: default;
    opacity: 0.4;
  }
  .name.is-default {
    color: var(--text-dim);
  }
  .name-input {
    background: color-mix(in oklab, var(--accent) 6%, transparent);
    color: var(--text);
    border: none;
    border-radius: 0;
    padding: 4px 8px;
    font: inherit;
    width: 100%;
    outline: none;
    box-shadow:
      inset 0 -1px 0 0 var(--accent),
      0 0 0 1px var(--accent);
    transition: background 80ms, box-shadow 80ms;
  }
  .hint {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
</style>
