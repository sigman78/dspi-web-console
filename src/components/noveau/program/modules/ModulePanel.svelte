<script lang="ts">
  import { getSession } from '@/components/sessionContext';
  import { noveauUi } from '../../noveauUi.svelte';
  import { resolveModule } from '../programModel';
  import PreampModule from './PreampModule.svelte';
  import InputEqModule from './InputEqModule.svelte';
  import LevellerModule from './LevellerModule.svelte';
  import CrossfeedModule from './CrossfeedModule.svelte';
  import LoudnessModule from './LoudnessModule.svelte';
  import PsybassModule from './PsybassModule.svelte';
  import SubharmModule from './SubharmModule.svelte';
  import UpmixModule from './UpmixModule.svelte';

  const s = getSession();
  const features = $derived(s.device.capabilities.features);
  const m = $derived(resolveModule(noveauUi.programModule, features));
</script>

<div class="mp" data-budget="program-module">
  {#if m === 'preamp'}
    <PreampModule />
  {:else if m === 'inputEq'}
    <InputEqModule />
  {:else if m === 'leveller'}
    <LevellerModule />
  {:else if m === 'crossfeed'}
    <CrossfeedModule />
  {:else if m === 'loudness'}
    <LoudnessModule />
  {:else if m === 'psybass'}
    <PsybassModule />
  {:else if m === 'subharm'}
    <SubharmModule />
  {:else if m === 'upmix'}
    <UpmixModule />
  {/if}
</div>

<style>
  .mp { height: 100%; min-width: 0; min-height: 0; overflow: hidden; }
</style>
