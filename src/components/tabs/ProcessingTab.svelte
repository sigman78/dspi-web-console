<script lang="ts">
  import LoudnessPanel from '@/components/processing/LoudnessPanel.svelte';
  import CrossfeedPanel from '@/components/processing/CrossfeedPanel.svelte';
  import LevellerPanel from '@/components/processing/LevellerPanel.svelte';
  import PsybassPanel from '@/components/processing/PsybassPanel.svelte';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const features = $derived(s.device.capabilities.features);
</script>

<div class="grid">
  <CrossfeedPanel />
  <LoudnessPanel />
  <LevellerPanel />
  {#if features.psybass}
    <PsybassPanel />
  {/if}
</div>

<style>
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--pad); }
</style>
