<script lang="ts">
  import BandRow from '@/components/noveau/tune/BandRow.svelte';
  import { FilterType, offeredTypes, type ChannelModel } from '@/domain';
  import { getSession } from '@/components/sessionContext';
  import { noveauUi } from '@/components/noveau/noveauUi.svelte';
  import InspectorSection from './InspectorSection.svelte';
  import { patchBand } from './bandOps';

  const COLUMNS = '20px 20px minmax(0, 1fr) 58px 40px 52px';

  const { channel }: { channel: ChannelModel } = $props();

  const s = getSession();
  const types = $derived(offeredTypes(s.device.capabilities.features));
  const used = $derived(channel.filters.filter((b) => b.type !== FilterType.Flat).length);
</script>

<InspectorSection title="Bands" caption={`${used} of ${channel.filters.length} in use`}>
  <div class="dense">
    <div class="head" style:grid-template-columns={COLUMNS}>
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
        <BandRow index={i} {band} {types} columns={COLUMNS} onPatch={(p) => patchBand(s, channel, i, p)} />
      </div>
    {/each}
  </div>
</InspectorSection>

<style>
  .dense { height: 280px; overflow: hidden; }
  .head {
    display: grid;
    gap: 2px;
    padding: 0 2px;
    height: 20px;
    align-items: center;
    font-family: var(--font-sans);
    font-size: 11px;
    color: var(--text-faint);
  }
  .head .r { text-align: right; padding-right: 4px; }
  .rw { border-radius: var(--radius-s); }
  .rw.sel { background: color-mix(in oklab, var(--accent) var(--tint), transparent); box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent) var(--tint-edge), transparent); }
  .dense :global(.rw .row) { gap: 2px; padding: 0 2px; min-height: 26px; border-top: none; }
  .dense :global(.vf) { padding: 0 3px; font-size: var(--fs-m); }
  .dense :global(.vf .unit) { display: none; }
</style>
