<script lang="ts">
  import ControlInterfacesPanel from '@/components/system/ControlInterfacesPanel.svelte';
  import ControlSurfacesPanel from '@/components/system/ControlSurfacesPanel.svelte';
  import CsGroupsPanel from '@/components/system/CsGroupsPanel.svelte';
  import CsMacrosPanel from '@/components/system/CsMacrosPanel.svelte';
  import CsDisplayPanel from '@/components/system/CsDisplayPanel.svelte';
  import ControlGuidePanel from './control/ControlGuidePanel.svelte';
  import { getSession } from '@/components/sessionContext';
  import * as CsField from '@/components/system/csFieldHelpers';

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
      {#if CsField.groupsAvailable(s.controlSurfaces.caps)}
        <CsGroupsPanel />
      {/if}
    {/if}
  </div>

  <div class="col">
    {#if features.controlSurfaces && CsField.macrosAvailable(s.controlSurfaces.caps)}
      <CsMacrosPanel />
    {/if}
    {#if features.controlSurfaces && CsField.displaysAvailable(s.controlSurfaces.caps)}
      <CsDisplayPanel />
    {/if}
    <ControlGuidePanel />
  </div>
</div>

<style>
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--pad); height: 100%; }
  .col { display: flex; flex-direction: column; gap: var(--pad); min-height: 0; }
</style>
