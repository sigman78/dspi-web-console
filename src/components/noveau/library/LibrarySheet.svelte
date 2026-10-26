<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { boundary } from '@/state';
  import { getSession } from '@/components/sessionContext';
  import { fetchPresetInfo, retryFetchPresetInfo } from '@/runtime';
  import LatestChangesPanel from '@/components/tabs/overview/LatestChangesPanel.svelte';
  import QuickRefPanel from '@/components/tabs/overview/QuickRefPanel.svelte';
  import { noveauUi, type LibraryAbout, type LibraryPage } from '../noveauUi.svelte';
  import SlotList from './SlotList.svelte';
  import SlotDetail from './SlotDetail.svelte';

  const s = getSession();
  const pages: { key: LibraryPage; label: string }[] = [
    { key: 'presets', label: 'PRESETS' },
    { key: 'about', label: 'ABOUT' },
  ];
  const aboutParts: { key: LibraryAbout; label: string }[] = [
    { key: 'changes', label: 'CHANGES' },
    { key: 'quickref', label: 'QUICK REF' },
  ];
  const selected = $derived(noveauUi.librarySlot ?? s.presets.active);

  let sheet: HTMLElement | undefined = $state();

  function close(): void {
    noveauUi.libraryOpen = false;
  }

  onMount(() => {
    void fetchPresetInfo(s);
    void tick().then(() => {
      sheet?.querySelector<HTMLElement>('.pg')?.focus();
    });
  });
  onDestroy(() => {
    noveauUi.librarySlot = null;
    document.querySelector<HTMLElement>('[data-library-toggle]')?.focus();
  });

  function focusables(): HTMLElement[] {
    return Array.from(sheet?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]):not([hidden]), [tabindex="0"]',
    ) ?? []);
  }

  function onKey(e: KeyboardEvent): void {
    if (boundary.pending != null) return;
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      close();
    }
  }

  function onSheetKey(e: KeyboardEvent): void {
    if (e.key !== 'Tab' || boundary.pending != null) return;
    const f = focusables();
    const i = f.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    if (e.shiftKey && i === 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="host">
  <button type="button" class="scrim" tabindex="-1" aria-label="Close library" onclick={close}></button>
  <div class="sheet" role="dialog" aria-modal="false" aria-label="Library" tabindex="-1" data-budget bind:this={sheet} onkeydown={onSheetKey}>
    <header>
      <span class="title">LIBRARY</span>
      <div class="pages" role="group" aria-label="Library pages">
        {#each pages as p (p.key)}
          <button
            type="button"
            class="pg"
            aria-pressed={noveauUi.libraryPage === p.key}
            onclick={() => { noveauUi.libraryPage = p.key; }}
          >{p.label}</button>
        {/each}
      </div>
      {#if noveauUi.libraryPage === 'about'}
        <div class="pages" role="group" aria-label="About sections">
          {#each aboutParts as p (p.key)}
            <button
              type="button"
              class="pg"
              aria-pressed={noveauUi.libraryAbout === p.key}
              onclick={() => { noveauUi.libraryAbout = p.key; }}
            >{p.label}</button>
          {/each}
        </div>
      {/if}
      <button type="button" class="x" aria-label="Close" onclick={close}>×</button>
    </header>

    <div class="body" data-budget="library-page">
      {#if noveauUi.libraryPage === 'presets'}
        {#if s.presets.directory == null && s.presets.lastFetchError}
          <div class="state err">
            <span>{s.presets.lastFetchError}</span>
            <button type="button" class="chip accent" onclick={() => retryFetchPresetInfo(s)} disabled={s.presets.busy}>RETRY</button>
          </div>
        {:else if s.presets.directory == null}
          <div class="state">Loading presets…</div>
        {:else}
          <div class="cols">
            <SlotList {selected} onSelect={(slot) => { noveauUi.librarySlot = slot; }} />
            {#if selected != null}
              <SlotDetail slot={selected} />
            {/if}
          </div>
        {/if}
      {:else}
        <div class="about">
          {#if noveauUi.libraryAbout === 'changes'}<LatestChangesPanel limit={6} />{:else}<QuickRefPanel />{/if}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .host {
    grid-column: 3;
    grid-row: 1;
    position: relative;
    z-index: 20;
  }
  .scrim {
    position: absolute;
    inset: 0;
    padding: 0;
    border: none;
    cursor: default;
    background: color-mix(in oklab, var(--bg) 60%, transparent);
  }
  .sheet {
    position: absolute;
    top: 0; right: 0; bottom: 0;
    width: 640px;
    max-width: 100%;
    box-sizing: border-box;
    display: grid;
    grid-template-rows: 28px minmax(0, 1fr);
    row-gap: 12px;
    padding: 12px 16px;
    overflow: hidden;
    background: var(--panel-solid);
    border-left: 1px solid var(--border-hi);
    box-shadow: -8px 0 24px oklch(0% 0 0 / 0.4);
    color: var(--text);
  }
  header { display: flex; align-items: center; gap: 16px; min-width: 0; }
  .title { font-family: var(--font-sans); font-size: 12px; font-weight: 600; letter-spacing: 0.5px; }
  .pages {
    display: flex;
    height: 28px;
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
  .pg:focus-visible, .x:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .pg[aria-pressed='true'] { color: var(--text); background: color-mix(in oklab, var(--accent) 14%, transparent); }
  .x {
    margin-left: auto;
    width: 28px; height: 28px; padding: 0;
    background: none; border: 1px solid transparent; border-radius: var(--radius-m);
    color: var(--text-dim); font-size: 18px; line-height: 1; cursor: pointer;
  }
  .x:hover { color: var(--text); border-color: var(--border-hi); }
  .body { min-width: 0; min-height: 0; overflow: hidden; }
  .cols { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 16px; align-items: start; min-height: 0; }
  .state { padding: 16px 0; font-family: var(--font-mono); font-size: 12px; color: var(--text-faint); }
  .state.err { color: var(--err); display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }
  .about { display: flex; flex-direction: column; gap: 12px; min-height: 0; overflow: hidden; }

  .about :global(section.panel) {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    border-radius: var(--radius-m);
  }
  .about :global(section.panel > header) {
    height: 28px;
    box-sizing: border-box;
    padding: 0 12px;
  }
  .about :global(section.panel > header .code) { display: none; }
  .about :global(section.panel > header .title) {
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.5px;
  }
</style>
