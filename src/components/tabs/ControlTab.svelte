<script lang="ts">
  import ControlInterfacesPanel from '@/components/system/ControlInterfacesPanel.svelte';
  import ControlSurfacesPanel from '@/components/system/ControlSurfacesPanel.svelte';
  import ControlGuidePanel from './control/ControlGuidePanel.svelte';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const features = $derived(s.device.capabilities.features);
</script>

<div class="grid">
  <div class="col">
    {#if features.controlInterfaces}
      <ControlInterfacesPanel />
    {/if}
  </div>

  <div class="col">
    {#if features.controlSurfaces}
      <ControlSurfacesPanel />
    {/if}
  </div>

  <div class="col">
    <ControlGuidePanel />
  </div>
</div>

<style>
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--pad); height: 100%; }
  .col { display: flex; flex-direction: column; gap: var(--pad); min-height: 0; }
</style>
