<script lang="ts">
  import BandRow from '@/components/eq/BandRow.svelte';
  import { offeredTypes } from '@/components/eq/BandTypeSelect.svelte';
  import { FilterType, type ChannelModel } from '@/domain';
  import { getSession } from '@/components/sessionContext';
  import { noveauUi } from '../noveauUi.svelte';
  import InspectorSection from './InspectorSection.svelte';
  import { patchBand } from './bandOps';

  const { channel }: { channel: ChannelModel } = $props();

  const s = getSession();
  const types = $derived(offeredTypes(s.device.capabilities.features));
  const used = $derived(channel.filters.filter((b) => b.type !== FilterType.Flat).length);
</script>

<InspectorSection title="Bands" caption={`${used} of ${channel.filters.length} in use`}>
  <div class="dense">
    <div class="head">
      <div>#</div>
      <div></div>
      <div>TYPE</div>
      <div class="r">FREQ</div>
      <div class="r">Q</div>
      <div class="r">GAIN</div>
    </div>
    {#each channel.filters as band, i (i)}
      <!-- The row's own controls are the keyboard path; the wrapper only mirrors focus into the selection. -->
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="rw" class:sel={noveauUi.selectedBand === i} onclick={() => (noveauUi.selectedBand = i)}>
        <BandRow index={i} {band} {types} onPatch={(p) => patchBand(s, channel, i, p)} />
      </div>
    {/each}
  </div>
</InspectorSection>

<style>
  .dense { height: 280px; overflow: hidden; }
  .head, .dense :global(.row) {
    grid-template-columns: 20px 20px minmax(0, 1fr) 58px 40px 52px !important;
    gap: 2px !important;
    padding: 0 2px !important;
  }
  .head {
    display: grid;
    height: 20px;
    align-items: center;
    font-family: var(--font-sans);
    font-size: 11px;
    color: var(--text-faint);
  }
  .head .r { text-align: right; padding-right: 4px; }
  .rw { border-radius: var(--radius-s); }
  .rw.sel { background: color-mix(in oklab, var(--accent) 12%, transparent); box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent) 45%, transparent); }
  .dense :global(.row) { min-height: 26px; border-top: none !important; }
  .dense :global(.vf) { padding: 0 3px; }
  .dense :global(.vf .unit) { display: none; }
</style>
