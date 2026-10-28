<script lang="ts">
  import { getSession } from '@/components/sessionContext';
  import DevicePanel from '@/components/noveau/setup/DevicePanel.svelte';
  import ControlInterfacesPanel from '@/components/noveau/setup/ControlInterfacesPanel.svelte';
  import InputConfigPanel from '@/components/noveau/setup/InputConfigPanel.svelte';
  import OutputsPanel from '@/components/noveau/setup/OutputsPanel.svelte';
  import AdatPanel from '@/components/noveau/setup/AdatPanel.svelte';
  import AdatInputPanel from '@/components/noveau/setup/AdatInputPanel.svelte';
  import I2sClockPanel from '@/components/noveau/setup/I2sClockPanel.svelte';
  import LgSoundSyncPanel from '@/components/noveau/setup/LgSoundSyncPanel.svelte';
  import DacHwMutePanel from '@/components/noveau/setup/DacHwMutePanel.svelte';
  import SysClockPanel from '@/components/noveau/setup/SysClockPanel.svelte';
  import BufferStatsPanel from '@/components/noveau/setup/BufferStatsPanel.svelte';
  import FirmwarePanel from '@/components/noveau/setup/FirmwarePanel.svelte';
  import StatsPanel from '@/components/noveau/setup/StatsPanel.svelte';
  import PagedWorkspace from '@/components/noveau/PagedWorkspace.svelte';
  import PinMapPanel from '@/components/chrome/PinMapPanel.svelte';
  import StagedStrip from '@/components/noveau/StagedStrip.svelte';
  import { noveauUi } from '@/components/noveau/noveauUi.svelte';
  import { debugPanels } from '@/devOptions';
  import { setupPages } from './setupPages';

  const s = getSession();
  const features = $derived(s.device.capabilities.features);
  const pages = $derived(setupPages(features));
  const page = $derived(pages.some((p) => p.key === noveauUi.setupPage) ? noveauUi.setupPage : pages[0].key);
</script>

{#snippet strip()}
  <div class="tools">
    <StagedStrip />
  </div>
{/snippet}

<PagedWorkspace
  label="Setup pages"
  {pages}
  {page}
  onselect={(k) => { noveauUi.setupPage = k; }}
  staged={(k) => s.staging.countOn(k) > 0}
  right={strip}
>
  {#if page === 'device'}
    <div class="pw-cols">
      <div class="pw-col" data-budget><DevicePanel /><SysClockPanel /></div>
      <div class="pw-col" data-budget><FirmwarePanel /></div>
      <div class="pw-col" data-budget><StatsPanel />{#if debugPanels()}<BufferStatsPanel />{/if}</div>
    </div>
  {:else if page === 'interfaces'}
    <div class="pw-cols">
      <div class="pw-col" data-budget><ControlInterfacesPanel /></div>
      <div class="pw-col pw-ref" data-budget><PinMapPanel /></div>
    </div>
  {:else if page === 'inputs'}
    <div class="pw-cols">
      <div class="pw-col" data-budget><InputConfigPanel /></div>
      <div class="pw-col" data-budget>
        {#if features.adatInput}<AdatInputPanel />{/if}
        <LgSoundSyncPanel />
      </div>
      <div class="pw-col pw-ref" data-budget><PinMapPanel /></div>
    </div>
  {:else}
    <div class="pw-cols">
      <div class="pw-col" data-budget>
        <OutputsPanel />
        {#if features.adatOutput}<AdatPanel />{/if}
      </div>
      <div class="pw-col" data-budget><I2sClockPanel /><DacHwMutePanel /></div>
      <div class="pw-col pw-ref" data-budget><PinMapPanel /></div>
    </div>
  {/if}
</PagedWorkspace>

<style>
  .tools { display: flex; align-items: center; gap: 10px; min-width: 0; }
</style>
