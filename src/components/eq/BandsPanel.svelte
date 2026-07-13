<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import BandRow, { BAND_ROW_COLS } from './BandRow.svelte';
  import type { FilterParams, FilterType, ChannelId } from '@/domain';

  const {
    bands,
    onPatch,
    onReset,
    copySource,
    currentChannel,
    onCopy,
    onPaste,
    onExit,
    types,
    onLibrary,
  }: {
    bands: FilterParams[];
    onPatch: (index: number, patch: Partial<FilterParams>) => void;
    onReset: () => void;
    copySource: ChannelId | null;
    currentChannel: ChannelId;
    onCopy: () => void;
    onPaste: () => void;
    onExit: () => void;
    types?: FilterType[];
    onLibrary?: () => void;
  } = $props();

  const inSelection = $derived(copySource != null);
  const onSource = $derived(copySource === currentChannel);
  const leftLabel = $derived(inSelection && !onSource ? 'PASTE' : 'COPY');
  const leftAction = $derived(inSelection && !onSource ? onPaste : onCopy);
  const rightLabel = $derived(inSelection ? 'EXIT' : 'RESET');
  const rightAction = $derived(inSelection ? onExit : onReset);
  const leftTitle = $derived(
    inSelection && !onSource
      ? 'Paste copied EQ settings here'
      : 'Copy this channel’s EQ settings',
  );
  const rightTitle = $derived(
    inSelection ? 'Exit copy mode' : 'Reset all bands and preamp',
  );
</script>

<Panel code="EQ.02" title="BANDS · 10 BIQUAD">
  {#snippet right()}
    {#if onLibrary && !inSelection}
      <button class="chip hi act" onclick={onLibrary} title="Browse the AutoEQ profile library">AUTOEQ</button>
    {/if}
    <button class="chip hi act" onclick={leftAction} title={leftTitle}>{leftLabel}</button>
    <button class="chip hi act" onclick={rightAction} title={rightTitle}>{rightLabel}</button>
  {/snippet}

  <div class="head" style:grid-template-columns={BAND_ROW_COLS}>
    <div>#</div>
    <div></div>
    <div>TYPE</div>
    <div class="r">FREQ</div>
    <div class="r">Q</div>
    <div class="r">GAIN</div>
  </div>

  {#each bands as band, i (i)}
    <BandRow index={i} {band} onPatch={(p) => onPatch(i, p)} {types} />
  {/each}
</Panel>

<style>
  .act + .act { margin-left: 6px; }

  .head {
    display: grid;
    /* grid-template-columns set inline (BAND_ROW_COLS), matching BandRow. */
    gap: 6px;
    padding: 8px 14px;
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-faint);
    letter-spacing: 1.2px;
    border-bottom: 1px solid var(--border);
  }
  /* Match ValueField's internal 8px horizontal padding so the numeric
     labels sit directly above their right-aligned values. */
  .head .r { text-align: right; padding-right: 8px; }
</style>
