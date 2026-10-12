<script lang="ts">
  import LoudnessPanel from '@/components/processing/LoudnessPanel.svelte';
  import CrossfeedPanel from '@/components/processing/CrossfeedPanel.svelte';
  import LevellerPanel from '@/components/processing/LevellerPanel.svelte';
  import PsybassPanel from '@/components/processing/PsybassPanel.svelte';
  import SubharmPanel from '@/components/processing/SubharmPanel.svelte';
  import LimiterPanel from '@/components/processing/LimiterPanel.svelte';
  import UpmixPanel from '@/components/processing/UpmixPanel.svelte';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const features = $derived(s.device.capabilities.features);
</script>

<!-- Three independent columns so every panel keeps its own height (a grid
     row would stretch each panel to its tallest neighbour). Placement
     balances the column heights on the full RP2350 surface:
     CROSSFEED + LEVELLER + PSYBASS | LOUDNESS + SUBHARMONIC | STEREO UPMIXER
     + LIMITER; the gated panels simply drop out on smaller profiles. -->
<div class="cols">
  <div class="col">
    <CrossfeedPanel />
    <LevellerPanel />
    {#if features.psybass}
      <PsybassPanel />
    {/if}
  </div>
  <div class="col">
    <LoudnessPanel />
    {#if features.subharm}
      <SubharmPanel />
    {/if}
  </div>
  <div class="col">
    {#if features.upmix}
      <UpmixPanel />
    {/if}
    {#if features.limiter}
      <LimiterPanel />
    {/if}
  </div>
</div>

<style>
  .cols { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--pad); align-items: start; }
  .col { display: flex; flex-direction: column; gap: var(--pad); min-width: 0; }
</style>
