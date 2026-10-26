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
  import PresetOptionsPanel from './PresetOptionsPanel.svelte';
  import CsChangesStrip from './CsChangesStrip.svelte';
  import TelemetryPanel from './TelemetryPanel.svelte';
  import ErrorCountersPanel from './ErrorCountersPanel.svelte';
  import { noveauUi } from '../noveauUi.svelte';
  import { setupPages } from './setupPages';

  const s = getSession();
  const features = $derived(s.device.capabilities.features);
  const caps = $derived(s.controlSurfaces.caps);
  const cs = $derived(features.controlSurfaces);
  const pages = $derived(setupPages(features, caps));
  let surfacesDetail = $state<HTMLElement | null>(null);
  let macrosDetail = $state<HTMLElement | null>(null);
  let displayDetail = $state<HTMLElement | null>(null);
  let groupsDetail = $state<HTMLElement | null>(null);
  let irDetail = $state<HTMLElement | null>(null);
  const page = $derived(pages.some((p) => p.key === noveauUi.setupPage) ? noveauUi.setupPage : pages[0].key);
  const showStrip = $derived(cs && (page === 'surfaces' || page === 'macros' || page === 'display'));
</script>

{#snippet host(title: string, hint: string, bind: (el: HTMLElement | null) => void)}
  <div class="detail" data-budget {@attach (el: HTMLElement) => { bind(el); return () => bind(null); }}>
    <header><span class="title">{title}</span></header>
    <div class="hint-empty">{hint}</div>
  </div>
{/snippet}

<div class="setup">
  <div class="toprow">
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
    {#if showStrip}<CsChangesStrip />{/if}
  </div>

  <div class="body" data-budget="setup-page">
    {#if cs}
      {#each ['surfaces', 'macros', 'display'] as k (k)}
        {#if pages.some((p) => p.key === k)}
          <div class="cols" hidden={page !== k}>
            {#if k === 'surfaces'}
              <div class="col" data-budget>
                <ControlSurfacesPanel detailTarget={surfacesDetail} irDetailTarget={irDetail} />
              </div>
              <div class="col" data-budget>{@render host('BINDING', 'Select a control on the left', (el) => (surfacesDetail = el))}</div>
              <div class="col" data-budget>{@render host('IR COMMANDS', 'Commands appear here for an IR receiver', (el) => (irDetail = el))}</div>
            {:else if k === 'macros'}
              <div class="col" data-budget>
                {#if CsField.macrosAvailable(caps)}<CsMacrosPanel detailTarget={macrosDetail} />{/if}
                {#if CsField.groupsAvailable(caps)}<CsGroupsPanel detailTarget={groupsDetail} />{/if}
              </div>
              <div class="col" data-budget>{@render host('MACRO', 'Select a macro on the left', (el) => (macrosDetail = el))}</div>
              <div class="col" data-budget>{@render host('GROUP', 'Select a group on the left', (el) => (groupsDetail = el))}</div>
            {:else}
              <div class="col" data-budget>
                <CsDisplayPanel detailTarget={displayDetail} />
              </div>
              <div class="col" data-budget>{@render host('DISPLAY PAGE', 'Select a page on the left', (el) => (displayDetail = el))}</div>
              <div class="col" data-budget></div>
            {/if}
          </div>
        {/if}
      {/each}
    {/if}
    {#if page === 'device'}
      <div class="cols">
        <div class="col" data-budget><DevicePanel /></div>
        <div class="col" data-budget><LgSoundSyncPanel /><DacHwMutePanel /></div>
        <div class="col" data-budget><PresetOptionsPanel /></div>
      </div>
    {:else if page === 'io'}
      <div class="cols">
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
      </div>
    {:else if page === 'interfaces'}
      <div class="cols">
        <div class="col" data-budget>
          {#if features.controlInterfaces}<ControlInterfacesPanel />{/if}
        </div>
        <div class="col" data-budget></div>
        <div class="col" data-budget></div>
      </div>
    {:else if page === 'diagnostics'}
      <div class="cols">
        <div class="col" data-budget><TelemetryPanel /></div>
        <div class="col" data-budget><ErrorCountersPanel /></div>
        <div class="col" data-budget><BufferStatsPanel /></div>
      </div>
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
  .toprow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-width: 0;
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
    white-space: nowrap;
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
    overflow: hidden;
  }
  .cols {
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    align-items: start;
    overflow: hidden;
  }
  .cols[hidden] { display: none; }
  .col {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow: hidden;
  }

  .detail {
    min-width: 0;
    box-sizing: border-box;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius-m);
    overflow: hidden;
  }
  .detail > header {
    height: 28px;
    box-sizing: border-box;
    padding: 0 12px;
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--border);
  }
  .detail > header .title {
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.5px;
  }
  .hint-empty {
    padding: 10px 12px;
    font-size: 11px;
    color: var(--text-dim);
  }
  .hint-empty:not(:last-child) { display: none; }

  .setup .cols .col :global(.addrow) { padding: 3px 12px; }

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
