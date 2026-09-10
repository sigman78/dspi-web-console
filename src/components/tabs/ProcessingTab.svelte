<script lang="ts">
  import LoudnessPanel from '@/components/processing/LoudnessPanel.svelte';
  import CrossfeedPanel from '@/components/processing/CrossfeedPanel.svelte';
  import LevellerPanel from '@/components/processing/LevellerPanel.svelte';
  import PsybassPanel from '@/components/processing/PsybassPanel.svelte';
  import SubharmPanel from '@/components/processing/SubharmPanel.svelte';
  import UpmixPanel from '@/components/processing/UpmixPanel.svelte';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const features = $derived(s.device.capabilities.features);
</script>

<div class="grid" class:has-upmix={features.upmix}>
  <CrossfeedPanel />
  <LoudnessPanel />
  <LevellerPanel />
  {#if features.psybass}
    <PsybassPanel />
  {/if}
  {#if features.subharm}
    <SubharmPanel />
  {/if}
  {#if features.upmix}
    <UpmixPanel />
  {/if}
</div>

<style>
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--pad); }
  /* Always three columns. Without the upmixer the non-upmix panels (five
     with PR.06's subharm on) auto-flow across columns 1-2. With it, STEREO
     UPMIXER (the tallest panel) is pinned to the whole 3rd column, spanning
     every row the others occupy — explicit placement claims those cells
     first, so the rest auto-flow into columns 1-2. It's always the last
     child when present (rendered after every other conditional panel), so
     :last-child pins it without a wrapper div. */
  .grid.has-upmix > :global(.panel):last-child { grid-column: 3; grid-row: 1 / -1; }
</style>
