<script lang="ts">
  import { getSession } from '@/components/sessionContext';
  import DevicePanel from '@/components/noveau/setup/DevicePanel.svelte';
  import InputConfigPanel from '@/components/noveau/setup/InputConfigPanel.svelte';
  import OutputsPanel from '@/components/noveau/setup/OutputsPanel.svelte';
  import AdatPanel from '@/components/noveau/setup/AdatPanel.svelte';
  import AdatInputPanel from '@/components/noveau/setup/AdatInputPanel.svelte';
  import PinMapPanel from '@/components/chrome/PinMapPanel.svelte';
  import I2sClockPanel from '@/components/noveau/setup/I2sClockPanel.svelte';
  import LgSoundSyncPanel from '@/components/noveau/setup/LgSoundSyncPanel.svelte';
  import DacHwMutePanel from '@/components/noveau/setup/DacHwMutePanel.svelte';
  import SysClockPanel from '@/components/noveau/setup/SysClockPanel.svelte';
  import BufferStatsPanel from '@/components/noveau/setup/BufferStatsPanel.svelte';
  import TelemetryPanel from './TelemetryPanel.svelte';
  import ErrorCountersPanel from './ErrorCountersPanel.svelte';
  import PagedWorkspace from '@/components/noveau/PagedWorkspace.svelte';
  import { noveauUi } from '@/components/noveau/noveauUi.svelte';
  import { SETUP_PAGES } from './setupPages';

  const s = getSession();
  const features = $derived(s.device.capabilities.features);
</script>

<PagedWorkspace
  label="Setup pages"
  pages={SETUP_PAGES}
  page={noveauUi.setupPage}
  onselect={(k) => { noveauUi.setupPage = k; }}
  staged={(k) => s.staging.countOn(k) > 0}
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
      <div class="pw-col" data-budget><div class="pw-ref"><PinMapPanel /></div></div>
    </div>
  {:else}
    <div class="pw-cols">
      <div class="pw-col" data-budget>
        <OutputsPanel />
        {#if features.adatOutput}<AdatPanel />{/if}
      </div>
      <div class="pw-col" data-budget><I2sClockPanel /><DacHwMutePanel /></div>
      <div class="pw-col" data-budget><div class="pw-ref"><PinMapPanel /></div></div>
    </div>
  {/if}
</PagedWorkspace>
