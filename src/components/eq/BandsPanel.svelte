<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import BandRow from './BandRow.svelte';
  import type { FilterParams, ChannelId } from '@/domain';

  const {
    bands,
    onPatch,
    onReset,
    copySource,
    currentChannel,
    onCopy,
    onPaste,
    onExit,
  }: {
    bands: FilterParams[];
    onPatch: (index: number, patch: Partial<FilterParams>) => void;
    onReset: () => void;
    copySource: ChannelId | null;
    currentChannel: ChannelId;
    onCopy: () => void;
    onPaste: () => void;
    onExit: () => void;
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
    <button class="btn" onclick={leftAction} title={leftTitle}>{leftLabel}</button>
    <button class="btn" onclick={rightAction} title={rightTitle}>{rightLabel}</button>
  {/snippet}

  <div class="head">
    <div>#</div>
    <div>TYPE</div>
    <div></div>
    <div class="r">FREQ</div>
    <div class="r">Q</div>
    <div class="r">GAIN</div>
  </div>

  {#each bands as band, i (i)}
    <BandRow index={i} {band} onPatch={(p) => onPatch(i, p)} />
  {/each}
</Panel>

<style>
  .btn {
    border: 1px solid var(--border-hi);
    background: transparent;
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 1px;
    padding: 3px 8px;
    border-radius: 3px;
    cursor: pointer;
  }
  .btn + .btn { margin-left: 6px; }
  .btn:hover { background: color-mix(in oklab, var(--text) 6%, transparent); color: var(--text); }

  .head {
    display: grid;
    grid-template-columns: 28px 100px 1fr 84px 64px 72px;
    gap: 6px;
    padding: 8px 14px;
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-faint);
    letter-spacing: 1.2px;
    border-bottom: 1px solid var(--border);
  }
  .head .r { text-align: right; }
</style>
