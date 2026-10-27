<script lang="ts">
  import { getSession } from '@/components/sessionContext';
  import * as CsField from '@/components/system/csFieldHelpers';
  import ControlInterfacesPanel from '@/components/system/ControlInterfacesPanel.svelte';
  import ControlSurfacesPanel from '@/components/system/ControlSurfacesPanel.svelte';
  import CsGroupsPanel from '@/components/system/CsGroupsPanel.svelte';
  import CsMacrosPanel from '@/components/system/CsMacrosPanel.svelte';
  import CsDisplayPanel from '@/components/system/CsDisplayPanel.svelte';
  import PinMapPanel from '@/components/system/PinMapPanel.svelte';
  import PagedWorkspace from '../PagedWorkspace.svelte';
  import CsChangesStrip from './CsChangesStrip.svelte';
  import { noveauUi } from '../noveauUi.svelte';
  import { controlPages } from './controlPages';

  const s = getSession();
  const features = $derived(s.device.capabilities.features);
  const caps = $derived(s.controlSurfaces.caps);
  const cs = $derived(features.controlSurfaces);
  const pages = $derived(controlPages(features, caps));
  let surfacesDetail = $state<HTMLElement | null>(null);
  let macrosDetail = $state<HTMLElement | null>(null);
  let displayDetail = $state<HTMLElement | null>(null);
  let groupsDetail = $state<HTMLElement | null>(null);
  let irDetail = $state<HTMLElement | null>(null);
  // NoveauShell only mounts this view while pages is non-empty.
  const page = $derived(pages.some((p) => p.key === noveauUi.controlPage) ? noveauUi.controlPage : pages[0].key);
  const showStrip = $derived(cs && (page === 'surfaces' || page === 'macros' || page === 'display'));
</script>

{#snippet host(title: string, hint: string, bind: (el: HTMLElement | null) => void)}
  <div class="detail" data-budget {@attach (el: HTMLElement) => { bind(el); return () => bind(null); }}>
    <header><span class="title">{title}</span></header>
    <div class="hint-empty">{hint}</div>
  </div>
{/snippet}

{#snippet strip()}
  {#if showStrip}<CsChangesStrip />{/if}
{/snippet}

<PagedWorkspace
  label="Control pages"
  {pages}
  {page}
  onselect={(k) => { noveauUi.controlPage = k; }}
  staged={(k) => s.staging.countOn(k) > 0}
  right={strip}
>
  {#if cs}
    {#each ['surfaces', 'macros', 'display'] as k (k)}
      {#if pages.some((p) => p.key === k)}
        <div class="pw-cols" hidden={page !== k}>
          {#if k === 'surfaces'}
            <div class="pw-col" data-budget>
              <ControlSurfacesPanel detailTarget={surfacesDetail} irDetailTarget={irDetail} />
            </div>
            <div class="pw-col" data-budget>{@render host('BINDING', 'Select a control on the left', (el) => (surfacesDetail = el))}</div>
            <div class="pw-col" data-budget>{@render host('IR COMMANDS', 'Commands appear here for an IR receiver', (el) => (irDetail = el))}</div>
          {:else if k === 'macros'}
            <div class="pw-col" data-budget>
              {#if CsField.macrosAvailable(caps)}<CsMacrosPanel detailTarget={macrosDetail} />{/if}
              {#if CsField.groupsAvailable(caps)}<CsGroupsPanel detailTarget={groupsDetail} />{/if}
            </div>
            <div class="pw-col" data-budget>{@render host('MACRO', 'Select a macro on the left', (el) => (macrosDetail = el))}</div>
            <div class="pw-col" data-budget>{@render host('GROUP', 'Select a group on the left', (el) => (groupsDetail = el))}</div>
          {:else}
            <div class="pw-col" data-budget>
              <CsDisplayPanel detailTarget={displayDetail} />
            </div>
            <div class="pw-col" data-budget>{@render host('DISPLAY PAGE', 'Select a page on the left', (el) => (displayDetail = el))}</div>
            <div class="pw-col" data-budget><div class="pw-ref"><PinMapPanel /></div></div>
          {/if}
        </div>
      {/if}
    {/each}
  {/if}
  {#if page === 'interfaces'}
    <div class="pw-cols">
      <div class="pw-col" data-budget>
        {#if features.controlInterfaces}<ControlInterfacesPanel />{/if}
      </div>
      <div class="pw-col" data-budget></div>
      <div class="pw-col" data-budget><div class="pw-ref"><PinMapPanel /></div></div>
    </div>
  {/if}
</PagedWorkspace>

<style>
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
</style>
