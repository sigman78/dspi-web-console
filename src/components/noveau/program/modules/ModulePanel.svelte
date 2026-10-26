<script lang="ts">
  import { getSession } from '@/components/sessionContext';
  import { noveauUi } from '../../noveauUi.svelte';
  import PreampModule from './PreampModule.svelte';
  import InputEqModule from './InputEqModule.svelte';
  import LevellerModule from './LevellerModule.svelte';
  import CrossfeedModule from './CrossfeedModule.svelte';
  import LoudnessModule from './LoudnessModule.svelte';
  import PsybassModule from './PsybassModule.svelte';
  import SubharmModule from './SubharmModule.svelte';
  import UpmixModule from './UpmixModule.svelte';
  import MatrixModule from './MatrixModule.svelte';
  import OutputStageModule from './OutputStageModule.svelte';

  const s = getSession();
  const features = $derived(s.device.capabilities.features);
  const m = $derived(noveauUi.programModule);
  const absent = $derived(
    (m === 'psybass' && !features.psybass) ||
    (m === 'subharm' && !features.subharm) ||
    (m === 'upmix' && !features.upmix),
  );
</script>

<div class="mp" data-budget="program-module">
  {#if absent}
    <p class="none">Not available on this firmware</p>
  {:else if m === 'preamp'}
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
  {:else if m === 'matrix'}
    <MatrixModule />
  {:else if m === 'outputStage'}
    <OutputStageModule />
  {/if}
</div>

<style>
  .mp { height: 100%; min-width: 0; min-height: 0; overflow: hidden; }
  .none { margin: 12px 4px; font-family: var(--font-sans); font-size: 11px; color: var(--text-faint); }
</style>
