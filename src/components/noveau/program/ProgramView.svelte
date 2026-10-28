<script lang="ts">
  import ChainStrip from './ChainStrip.svelte';
  import RoutingMap from './RoutingMap.svelte';
  import ModulePanel from '@/components/noveau/program/modules/ModulePanel.svelte';
</script>

<div class="program">
  <div class="strip" data-budget><ChainStrip /></div>
  <div class="body">
    <RoutingMap />
    <div class="module" data-budget><ModulePanel /></div>
  </div>
</div>

<style>
  .program {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-rows: 88px minmax(0, 1fr);
    row-gap: 12px;
    overflow: hidden;
  }
  .strip { min-width: 0; overflow: hidden; display: grid; }
  .body {
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-columns: fit-content(620px) minmax(480px, 1fr);
    column-gap: 24px;
    overflow: hidden;
  }
  .module { min-width: 0; min-height: 0; overflow: hidden; }
</style>
