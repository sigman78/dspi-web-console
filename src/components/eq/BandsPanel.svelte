<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import BandRow, { BAND_ROW_COLS } from './BandRow.svelte';
  import ConfirmButton from '@/components/chrome/ConfirmButton.svelte';
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
    link,
    onToggleLink,
    onSyncLink,
    needsSyncConfirm,
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
    link: { grouped: boolean; locked: boolean; diverged: boolean; peerLabel: string; selectedShort: string };
    onToggleLink: () => void;
    onSyncLink: () => void;
    needsSyncConfirm: boolean;
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

  const linkTitle = $derived(
    link.locked
      ? `Unlink from ${link.peerLabel}`
      : `Link with ${link.peerLabel}: edits mirror to it, copying this channel's EQ first`,
  );
  const title = $derived(
    `BANDS · 10 BIQUAD${link.locked ? ` · ${link.selectedShort}+${link.peerLabel}` : ''}`,
  );
</script>

{#snippet lockGlyph(closed: boolean)}
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="3" y="7" width="10" height="7" rx="1.5" />
    <path d={closed ? 'M5 7V5a3 3 0 0 1 6 0v2' : 'M5 7V5a3 3 0 0 1 5.6-1.5'} />
  </svg>
{/snippet}

{#snippet openLock()}{@render lockGlyph(false)}{/snippet}

<Panel code="EQ.02" {title}>
  {#snippet right()}
    {#if link.grouped}
      {#if needsSyncConfirm && !link.locked}
        <ConfirmButton
          label="LINK"
          confirmLabel={`COPY → ${link.peerLabel}`}
          tone="warn"
          extraClass="hi act"
          title={linkTitle}
          icon={openLock}
          onConfirm={onToggleLink}
        />
      {:else}
        <button
          class="chip hi act link"
          class:on={link.locked}
          class:diverged={link.diverged}
          title={linkTitle}
          aria-pressed={link.locked}
          onclick={onToggleLink}
        >{@render lockGlyph(link.locked)}LINK</button>
      {/if}
      {#if link.diverged && !inSelection}
        <ConfirmButton
          label="SYNC"
          confirmLabel={`COPY → ${link.peerLabel}`}
          tone="warn"
          extraClass="hi act"
          title={`Copy this channel's EQ onto ${link.peerLabel}`}
          onConfirm={onSyncLink}
        />
      {/if}
    {/if}
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
  .act + :global(.act), :global(.act) + .act { margin-left: 6px; }
  .link { display: inline-flex; align-items: center; gap: 5px; }
  .link.diverged { color: var(--warn); }

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
