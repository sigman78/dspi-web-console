<script lang="ts">
  import ConfirmButton from '@/components/chrome/ConfirmButton.svelte';
  import AutoEqBrowser from '@/components/noveau/tune/AutoEqBrowser.svelte';
  import { eqUi, setEqCopySource, clearEqCopySource } from '@/state';
  import { copyEqBands, setEqFilter } from '@/runtime';
  import type { ChannelModel } from '@/domain';
  import { getSession } from '@/components/sessionContext';
  import { noveauUi } from '@/components/noveau/noveauUi.svelte';
  import { resetBands } from './bandOps';
  import { firstFlatIndex, planAddBand } from './eqDraft';

  const { channel, libraryPreampDb }: { channel: ChannelModel; libraryPreampDb: number } = $props();

  const s = getSession();
  let libOpen = $state(false);

  const inSelection = $derived(eqUi.copySource != null);
  const onSource = $derived(eqUi.copySource === channel.id);
  const full = $derived(firstFlatIndex(channel.filters) < 0);
  const canPaste = $derived(inSelection && !onSource);

  function addBand() {
    const plan = planAddBand(channel.filters, 1000, 0);
    if (!plan) return;
    setEqFilter(s, channel.id, plan.index, plan.band);
    noveauUi.selectedBand = plan.index;
  }

  function reset() {
    resetBands(s, channel);
    noveauUi.selectedBand = null;
  }

  // Drop the copy source if its channel disappears, and leave copy mode when
  // the view goes away.
  $effect(() => {
    const src = eqUi.copySource;
    if (src == null) return;
    if (!s.mirror.current?.channels.some((c) => c.id === src)) clearEqCopySource();
  });
  $effect(() => () => clearEqCopySource());
</script>

<div class="bar">
  <button type="button" class="chip hi" disabled={full} title={full ? 'All bands are in use' : undefined} onclick={addBand}>+ Add band</button>
  {#if !inSelection}
    <button type="button" class="chip hi" title="Browse the AutoEQ profile library" onclick={() => (libOpen = true)}>AutoEQ…</button>
  {/if}
  {#if canPaste}
    <button type="button" class="chip hi" title="Paste copied EQ settings here" onclick={() => copyEqBands(s, eqUi.copySource!, channel.id)}>Paste</button>
  {:else}
    <button type="button" class="chip hi" title="Copy this channel’s EQ settings" onclick={() => setEqCopySource(channel.id)}>Copy</button>
  {/if}
  {#if inSelection}
    <button type="button" class="chip hi" title="Exit copy mode" onclick={clearEqCopySource}>Exit</button>
  {:else}
    <ConfirmButton label="Reset" confirmLabel="Reset all?" tone="danger" extraClass="hi" title="Reset all bands" onConfirm={reset} />
  {/if}
</div>

{#if libOpen}
  <AutoEqBrowser {channel} preampDb={libraryPreampDb} onClose={() => (libOpen = false)} />
{/if}

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    border-top: 1px solid var(--border);
  }
</style>
