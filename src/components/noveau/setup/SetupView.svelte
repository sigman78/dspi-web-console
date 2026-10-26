<script lang="ts">
  import { getSession } from '@/components/sessionContext';
  import * as CsField from '@/components/system/csFieldHelpers';
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
  import ControlInterfacesPanel from '@/components/system/ControlInterfacesPanel.svelte';
  import ControlSurfacesPanel from '@/components/system/ControlSurfacesPanel.svelte';
  import CsGroupsPanel from '@/components/system/CsGroupsPanel.svelte';
  import CsMacrosPanel from '@/components/system/CsMacrosPanel.svelte';
  import CsDisplayPanel from '@/components/system/CsDisplayPanel.svelte';
  import CsChangesPanel from '@/components/tabs/control/CsChangesPanel.svelte';
  import TelemetryPanel from './TelemetryPanel.svelte';
  import ErrorCountersPanel from './ErrorCountersPanel.svelte';
  import { noveauUi } from '../noveauUi.svelte';
  import { setupPages } from './setupPages';

  const s = getSession();
  const features = $derived(s.device.capabilities.features);
  const caps = $derived(s.controlSurfaces.caps);
  const cs = $derived(features.controlSurfaces);
  const pages = $derived(setupPages(features, caps));
  const page = $derived(pages.some((p) => p.key === noveauUi.setupPage) ? noveauUi.setupPage : pages[0].key);
</script>

<div class="setup">
  <div class="pages" role="group" aria-label="Setup pages">
    {#each pages as p (p.key)}
      <button
        type="button"
        class="pg"
        aria-pressed={p.key === page}
        onclick={() => { noveauUi.setupPage = p.key; }}
      >{p.label}</button>
    {/each}
  </div>

  <div class="body" data-budget="setup-page">
    {#if page === 'device'}
      <div class="col" data-budget><DevicePanel /></div>
      <div class="col" data-budget><LgSoundSyncPanel /><DacHwMutePanel /></div>
      <div class="col" data-budget></div>
    {:else if page === 'io'}
      <div class="col" data-budget><SysClockPanel /><I2sClockPanel /></div>
      <div class="col" data-budget>
        <InputConfigPanel />
        {#if features.adatInput}<AdatInputPanel />{/if}
      </div>
      <div class="col" data-budget>
        <OutputsPanel />
        {#if features.adatOutput}<AdatPanel />{/if}
        <PinMapPanel />
      </div>
    {:else if page === 'interfaces'}
      <div class="col" data-budget>
        {#if features.controlInterfaces}<ControlInterfacesPanel />{/if}
      </div>
      <div class="col" data-budget>
        {#if cs}<CsChangesPanel />{/if}
      </div>
      <div class="col" data-budget></div>
    {:else if page === 'surfaces'}
      <div class="col" data-budget>
        {#if cs}<CsChangesPanel /><ControlSurfacesPanel />{/if}
      </div>
      <div class="col" data-budget>
        {#if cs && CsField.macrosAvailable(caps)}<CsMacrosPanel />{/if}
      </div>
      <div class="col" data-budget>
        {#if cs && CsField.groupsAvailable(caps)}<CsGroupsPanel />{/if}
      </div>
    {:else if page === 'display'}
      <div class="col" data-budget>
        {#if cs}<CsChangesPanel />{/if}
        {#if cs && CsField.displaysAvailable(caps)}<CsDisplayPanel />{/if}
      </div>
      <div class="col" data-budget></div>
      <div class="col" data-budget></div>
    {:else}
      <div class="col" data-budget><TelemetryPanel /></div>
      <div class="col" data-budget><ErrorCountersPanel /></div>
      <div class="col" data-budget><BufferStatsPanel /></div>
    {/if}
  </div>
</div>

<style>
  .setup {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-rows: 28px minmax(0, 1fr);
    row-gap: 12px;
    overflow: hidden;
  }
  .pages {
    display: flex;
    align-items: stretch;
    height: 28px;
    width: max-content;
    border: 1px solid var(--border);
    border-radius: var(--radius-m);
    overflow: hidden;
    background: var(--wash-faint);
  }
  .pg {
    font-family: var(--font-sans);
    font-size: 11px;
    letter-spacing: 0.5px;
    font-weight: 600;
    padding: 0 16px;
    background: transparent;
    border: none;
    border-right: 1px solid var(--border);
    color: var(--text-dim);
    cursor: pointer;
  }
  .pg:last-child { border-right: none; }
  .pg:hover:not([aria-pressed='true']) { color: var(--text); background: var(--wash); }
  .pg:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .pg[aria-pressed='true'] {
    color: var(--text);
    background: color-mix(in oklab, var(--accent) 14%, transparent);
  }
  .body {
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    align-items: start;
    overflow: hidden;
  }
  .col {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow: hidden;
  }

  .setup :global(section.panel) {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    border-radius: var(--radius-m);
  }
  .setup :global(section.panel > header) {
    height: 28px;
    box-sizing: border-box;
    padding: 0 12px;
  }
  .setup :global(section.panel > header .code) { display: none; }
  .setup :global(section.panel > header .title) {
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.5px;
  }
</style>
