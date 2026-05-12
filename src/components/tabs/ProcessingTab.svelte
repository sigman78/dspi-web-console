<script lang="ts">
  import LoudnessPanel from '../processing/LoudnessPanel.svelte';
  import CrossfeedPanel from '../processing/CrossfeedPanel.svelte';
  import LevellerPanel from '../processing/LevellerPanel.svelte';
</script>

<div class="grid">
  <CrossfeedPanel />
  <LoudnessPanel />
  <LevellerPanel />
</div>

<style>
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--pad); }
</style>
