<script lang="ts">
  import { getSession } from '@/components/sessionContext';
  import DevicePanel from '@/components/system/DevicePanel.svelte';
  import InputConfigPanel from '@/components/system/InputConfigPanel.svelte';
  import OutputsPanel from '@/components/system/OutputsPanel.svelte';
  import AdatPanel from '@/components/system/AdatPanel.svelte';
  import AdatInputPanel from '@/components/system/AdatInputPanel.svelte';
  import PinMapPanel from '@/components/system/PinMapPanel.svelte';
  import I2sClockPanel from '@/components/system/I2sClockPanel.svelte';
  import LgSoundSyncPanel from '@/components/system/LgSoundSyncPanel.svelte';
  import DacHwMutePanel from '@/components/system/DacHwMutePanel.svelte';
  import SysClockPanel from '@/components/system/SysClockPanel.svelte';
  import BufferStatsPanel from '@/components/system/BufferStatsPanel.svelte';
  import TelemetryPanel from './TelemetryPanel.svelte';
  import ErrorCountersPanel from './ErrorCountersPanel.svelte';
  import PagedWorkspace from '../PagedWorkspace.svelte';
  import { noveauUi } from '../noveauUi.svelte';
  import { SETUP_PAGES } from './setupPages';

  const s = getSession();
  const features = $derived(s.device.capabilities.features);
</script>

<PagedWorkspace
  label="Setup pages"
  pages={SETUP_PAGES}
  page={noveauUi.setupPage}
  onselect={(k) => { noveauUi.setupPage = k; }}
>
  {#if noveauUi.setupPage === 'device'}
    <div class="pw-cols">
      <div class="pw-col" data-budget><DevicePanel /></div>
      <div class="pw-col" data-budget><TelemetryPanel /><SysClockPanel /></div>
      <div class="pw-col" data-budget><ErrorCountersPanel /><BufferStatsPanel /></div>
    </div>
  {:else if noveauUi.setupPage === 'inputs'}
    <div class="pw-cols">
      <div class="pw-col" data-budget><InputConfigPanel /></div>
      <div class="pw-col" data-budget>
        {#if features.adatInput}<AdatInputPanel />{/if}
        <LgSoundSyncPanel />
      </div>
      <div class="pw-col" data-budget></div>
    </div>
  {:else}
    <div class="pw-cols">
      <div class="pw-col" data-budget>
        <OutputsPanel />
        {#if features.adatOutput}<AdatPanel />{/if}
      </div>
      <div class="pw-col" data-budget><I2sClockPanel /><DacHwMutePanel /></div>
      <div class="pw-col" data-budget><PinMapPanel /></div>
    </div>
  {/if}
</PagedWorkspace>
