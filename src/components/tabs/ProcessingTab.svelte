<script lang="ts">
  import LoudnessPanel from '@/components/processing/LoudnessPanel.svelte';
  import CrossfeedPanel from '@/components/processing/CrossfeedPanel.svelte';
  import LevellerPanel from '@/components/processing/LevellerPanel.svelte';
  import PsybassPanel from '@/components/processing/PsybassPanel.svelte';
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
  {#if features.upmix}
    <UpmixPanel />
  {/if}
</div>

<style>
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--pad); }
  /* UPMIX (the tallest panel) takes a dedicated 3rd column spanning both rows
     of the 2x2 block to its left. It's always the last child when present
     (rendered after the conditional PSYBASS), so :last-child pins it there
     without a wrapper div. Without the feature, the grid degrades to the
     plain 2-column 2x2 flow the other four panels already used. */
  .grid.has-upmix { grid-template-columns: repeat(2, 1fr) 1fr; }
  .grid.has-upmix > :global(.panel):last-child { grid-column: 3; grid-row: 1 / span 2; }
</style>
