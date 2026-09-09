<script lang="ts">
  import ControlInterfacesPanel from '@/components/system/ControlInterfacesPanel.svelte';
  import ControlSurfacesPanel from '@/components/system/ControlSurfacesPanel.svelte';
  import CsGroupsPanel from '@/components/system/CsGroupsPanel.svelte';
  import CsMacrosPanel from '@/components/system/CsMacrosPanel.svelte';
  import CsDisplayPanel from '@/components/system/CsDisplayPanel.svelte';
  import CsChangesPanel from './control/CsChangesPanel.svelte';
  import { getSession } from '@/components/sessionContext';
  import * as CsField from '@/components/system/csFieldHelpers';

  const s = getSession();
  const features = $derived(s.device.capabilities.features);
  const cs = $derived(features.controlSurfaces);
  const caps = $derived(s.controlSurfaces.caps);
</script>

<!-- Bounded-height panels share the first column; the two list editors that
     grow per item each get a column of their own. Natural height, page
     scrolls -- same as SYSTEM. -->
<div class="grid">
  <div class="col">
    {#if cs}
      <CsChangesPanel />
    {/if}
    {#if features.controlInterfaces}
      <ControlInterfacesPanel />
    {/if}
    {#if cs && CsField.groupsAvailable(caps)}
      <CsGroupsPanel />
    {/if}
    {#if cs && CsField.displaysAvailable(caps)}
      <CsDisplayPanel />
    {/if}
  </div>

  <div class="col">
    {#if cs}
      <ControlSurfacesPanel />
    {/if}
  </div>

  <div class="col">
    {#if cs && CsField.macrosAvailable(caps)}
      <CsMacrosPanel />
    {/if}
  </div>
</div>

<style>
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--pad); min-height: 100%; }
  .col { display: flex; flex-direction: column; gap: var(--pad); min-height: 0; }
</style>
