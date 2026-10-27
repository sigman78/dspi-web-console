<script lang="ts">
  import { settings } from '@/state';
  import { FilterType, inputIndexOf, type ChannelId } from '@/domain';
  import { chShade } from '@/styles/palette';
  import { getSession } from '@/components/sessionContext';
  import { noveauUi } from '@/components/noveau/noveauUi.svelte';
  import EqGraph from './EqGraph.svelte';
  import Inspector from './Inspector.svelte';
  import InputStage from './InputStage.svelte';
  import OutputStage from './OutputStage.svelte';
  import Toolbar from './Toolbar.svelte';

  const s = getSession();
  const snap = $derived(s.mirror.current);

  // The shell reconciles a missing or hidden selection to the first visible
  // channel, so a null channel here only means there is nothing to show.
  const channel = $derived(
    settings.selectedChannel != null ? (snap?.channels.find((c) => c.id === settings.selectedChannel) ?? null) : null,
  );
  const output = $derived(channel?.isOutput ? (snap?.outputs.find((o) => o.id === channel.id) ?? null) : null);
  const inputSlot = $derived(channel ? inputIndexOf(channel.id) : null);
  const preampDb = $derived(inputSlot !== null ? (snap?.inputPreampDb[inputSlot] ?? 0) : 0);
  const libraryPreampDb = $derived(inputSlot !== null ? preampDb : (output?.gainDb ?? 0));
  const chain = $derived(
    channel?.isOutput ? 'output EQ → trim → delay → limiter' : 'preamp → input EQ → program → matrix',
  );

  // The selected band belongs to one channel: drop it on a switch, and when
  // the band is cleared (reset, paste) after having been in use.
  let lastChannelId: ChannelId | null = null;
  $effect(() => {
    const id = channel?.id ?? null;
    if (lastChannelId !== null && id !== lastChannelId) noveauUi.selectedBand = null;
    lastChannelId = id;
  });
  let seenIndex: number | null = null;
  let seenInUse = false;
  $effect(() => {
    const i = noveauUi.selectedBand;
    const type = i !== null ? channel?.filters[i]?.type : undefined;
    if (i !== seenIndex) {
      seenIndex = i;
      seenInUse = false;
    }
    if (type === undefined) return;
    if (type !== FilterType.Flat) seenInUse = true;
    else if (seenInUse) noveauUi.selectedBand = null;
  });
</script>

{#if channel}
  <div class="tune">
    <div class="left" data-budget>
      <div class="graphArea" data-budget>
        <header>
          <span class="dot" style:background={chShade(channel.id, 'bright')}></span>
          <h2>{channel.name}</h2>
          <span class="chain">{chain}</span>
          <span class="view">Combined</span>
        </header>
        <EqGraph {channel} {preampDb} />
      </div>
      {#if output}
        <OutputStage {output} />
      {:else}
        <InputStage channelId={channel.id} />
      {/if}
      <Toolbar {channel} {libraryPreampDb} />
    </div>
    <Inspector {channel} {output} />
  </div>
{:else}
  <div class="empty">No channel to show</div>
{/if}

<style>
  .tune {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr 300px;
    overflow: hidden;
  }
  .left {
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-rows: minmax(300px, 440px) 1fr 32px;
    overflow: hidden;
    padding-right: 12px;
  }
  .graphArea {
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  header {
    flex: 0 0 32px;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .dot { width: 8px; height: 8px; border-radius: var(--radius-xs); }
  h2 { margin: 0; font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--text); }
  .chain { font-family: var(--font-sans); font-size: 11px; color: var(--text-dim); }
  .view { margin-left: auto; font-family: var(--font-sans); font-size: 11px; color: var(--text-dim); }
  .empty {
    flex: 1;
    display: grid;
    place-items: center;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-faint);
  }
</style>
