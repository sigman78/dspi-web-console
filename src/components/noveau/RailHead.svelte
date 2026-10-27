<script lang="ts">
  import DeviceSwitcher from '@/components/chrome/DeviceSwitcher.svelte';
  import SceneRow from './SceneRow.svelte';
  import PresetsFlyout from './presets/PresetsFlyout.svelte';
  import { noveauUi } from './noveauUi.svelte';
  import VolumeBlock from './VolumeBlock.svelte';
</script>

<div class="rhead">
  <DeviceSwitcher />
  <SceneRow />
  <VolumeBlock />
  {#if noveauUi.presetsOpen}<PresetsFlyout />{/if}
</div>

<style>
  .rhead {
    position: relative;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
  }
  .rhead :global(.icon-toggle) { flex: none; width: 22px; height: 22px; }
</style>
