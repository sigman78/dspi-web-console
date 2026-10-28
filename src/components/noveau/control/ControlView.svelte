<script lang="ts">
  import { getSession } from '@/components/sessionContext';
  import * as CsField from '@/domain/cs/fieldHelpers';
  import ControlSurfacesPanel from '@/components/noveau/control/ControlSurfacesPanel.svelte';
  import CsGroupsPanel from '@/components/noveau/control/CsGroupsPanel.svelte';
  import CsMacrosPanel from '@/components/noveau/control/CsMacrosPanel.svelte';
  import CsDisplayPanel from '@/components/noveau/control/CsDisplayPanel.svelte';
  import PagedWorkspace from '@/components/noveau/PagedWorkspace.svelte';
  import Panel from '@/components/chrome/Panel.svelte';
  import PinMapPanel from '@/components/chrome/PinMapPanel.svelte';
  import StagedStrip from '@/components/noveau/StagedStrip.svelte';
  import CsChangesStrip from './CsChangesStrip.svelte';
  import { noveauUi } from '@/components/noveau/noveauUi.svelte';
  import { controlPages, CONTROL_PAGE_DRAFTS } from './controlPages';

  const s = getSession();
  const caps = $derived(s.controlSurfaces.caps);
  const pages = $derived(controlPages(caps));
  let surfacesDetail = $state<HTMLElement | null>(null);
  let macrosDetail = $state<HTMLElement | null>(null);
  let displayDetail = $state<HTMLElement | null>(null);
  let groupsDetail = $state<HTMLElement | null>(null);
  let irDetail = $state<HTMLElement | null>(null);
  // NoveauShell only mounts this view while pages is non-empty.
  const page = $derived(pages.some((p) => p.key === noveauUi.controlPage) ? noveauUi.controlPage : pages[0].key);
  const macrosOn = $derived(CsField.macrosAvailable(caps));
  const groupsOn = $derived(CsField.groupsAvailable(caps));
</script>

{#snippet host(title: string, hint: string, bind: (el: HTMLElement | null) => void)}
  <div class="detail" data-budget>
    <Panel {title}>
      <div {@attach (el: HTMLElement) => { bind(el); return () => bind(null); }}>
        <div class="hint-empty">{hint}</div>
      </div>
    </Panel>
  </div>
{/snippet}

{#snippet strip()}
  <div class="tools">
    <StagedStrip rule />
    <CsChangesStrip />
  </div>
{/snippet}

<PagedWorkspace
  label="Control pages"
  {pages}
  {page}
  onselect={(k) => { noveauUi.controlPage = k; }}
  draft={(k) => CONTROL_PAGE_DRAFTS[k].some((f) => s.drafts.dirtyCount(f) > 0)}
  right={strip}
>
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
          {#if macrosOn}
            <div class="pw-col" data-budget><CsMacrosPanel detailTarget={macrosDetail} visible={page === 'macros'} /></div>
            <div class="pw-col" data-budget>{@render host('MACRO', 'Select a macro on the left', (el) => (macrosDetail = el))}</div>
          {/if}
          {#if groupsOn && macrosOn}
            <div class="pw-col" data-budget>
              <CsGroupsPanel detailTarget={groupsDetail} />
              {@render host('GROUP', 'Select a group above', (el) => (groupsDetail = el))}
            </div>
          {:else if groupsOn}
            <div class="pw-col" data-budget><CsGroupsPanel detailTarget={groupsDetail} /></div>
            <div class="pw-col" data-budget>{@render host('GROUP', 'Select a group on the left', (el) => (groupsDetail = el))}</div>
          {/if}
        {:else}
          <div class="pw-col" data-budget>
            <CsDisplayPanel detailTarget={displayDetail} visible={page === 'display'} />
          </div>
          <div class="pw-col" data-budget>{@render host('DISPLAY PAGE', 'Select a page on the left', (el) => (displayDetail = el))}</div>
          <div class="pw-col pw-ref" data-budget><PinMapPanel /></div>
        {/if}
      </div>
    {/if}
  {/each}
</PagedWorkspace>

<style>
  .tools { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .detail { min-width: 0; }
  .hint-empty {
    padding: 10px 12px;
    font-size: 11px;
    color: var(--text-dim);
  }
  .hint-empty:not(:last-child) { display: none; }
</style>
