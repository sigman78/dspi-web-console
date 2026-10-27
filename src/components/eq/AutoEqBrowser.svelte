<script lang="ts">
  import { onMount } from 'svelte';
  import {
    type ChannelModel, type AutoEqEntry,
    FilterType, autoEqDisplayName, autoEqSourceLabel, autoEqFiltersToBands,
  } from '@/domain';
  import {
    autoEqDb, autoEqEntries, ensureAutoEqDb, isAutoEqFavorite, toggleAutoEqFavorite,
    saveAutoEqUserEntry, deleteAutoEqUserEntry, searchAutoEq,
  } from '@/state';
  import { applyAutoEqEntry, preampTargetLabel, hasStereoTwin } from '@/runtime';
  import ConfirmButton from '@/components/chrome/ConfirmButton.svelte';
  import Modal from '@/components/chrome/Modal.svelte';
  import { getSession } from '@/components/sessionContext';

  const {
    channel,
    preampDb,
    onClose,
  }: {
    channel: ChannelModel;
    preampDb: number;
    onClose: () => void;
  } = $props();

  const s = getSession();

  onMount(() => {
    ensureAutoEqDb();
  });

  let query = $state('');
  let scope = $state<'all' | 'favs' | 'user'>('all');
  let selectedId = $state<string | null>(null);
  let saveName = $state('');

  const PAGE_SIZE = 12;

  const results = $derived(searchAutoEq(query, scope));
  let page = $state(0);
  const pageCount = $derived(Math.max(1, Math.ceil(results.length / PAGE_SIZE)));
  const pageIdx = $derived(Math.min(page, pageCount - 1));
  const visible = $derived(results.slice(pageIdx * PAGE_SIZE, (pageIdx + 1) * PAGE_SIZE));
  const rangeFrom = $derived(results.length === 0 ? 0 : pageIdx * PAGE_SIZE + 1);
  const rangeTo = $derived(pageIdx * PAGE_SIZE + visible.length);

  function goPage(delta: number) {
    page = Math.min(pageCount - 1, Math.max(0, pageIdx + delta));
  }

  function setScope(next: 'all' | 'favs' | 'user') {
    scope = next;
    page = 0;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'PageDown' && e.key !== 'PageUp') return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    e.preventDefault();
    goPage(e.key === 'PageDown' ? 1 : -1);
  }

  const allEntries = $derived(searchAutoEq('', 'all'));
  const selectedEntry = $derived(allEntries.find((e) => e.id === selectedId) ?? null);

  const generatedDate = $derived(autoEqDb.generatedAt?.split('T')[0] ?? '');

  const hasTwin = $derived.by(() => {
    const chans = s.mirror.current?.channels;
    return chans ? hasStereoTwin(chans, channel.id) : false;
  });

  const selectedBandCount = $derived(
    selectedEntry
      ? autoEqFiltersToBands(selectedEntry.filters).filter((b) => b.type !== FilterType.Flat).length
      : 0,
  );

  function shortName(e: AutoEqEntry): string {
    const name = autoEqDisplayName(e);
    return name.length > 22 ? `${name.slice(0, 21)}…` : name;
  }

  function sourceHue(source: string): string {
    switch (source) {
      case 'oratory1990': return 'oratory';
      case 'crinacle': return 'crinacle';
      case 'rtings': return 'rtings';
      case 'innerfidelity': return 'innerfidelity';
      case 'user': return 'user';
      default: return 'other';
    }
  }

  function selectRow(id: string) {
    selectedId = id;
  }

  function onFav(e: MouseEvent, id: string) {
    e.stopPropagation();
    toggleAutoEqFavorite(id);
  }

  function onDelete(id: string) {
    deleteAutoEqUserEntry(id);
    if (selectedId === id) selectedId = null;
  }

  function applyTo(includePairTwin: boolean) {
    if (!selectedEntry) return;
    applyAutoEqEntry(s, channel.id, selectedEntry, includePairTwin);
    onClose();
  }

  function onSave() {
    const trimmed = saveName.trim();
    if (!trimmed) return;
    saveAutoEqUserEntry(trimmed, preampDb, channel.filters);
    saveName = '';
    setScope('user');
  }
</script>

<Modal ariaLabel="AutoEQ library" initialFocus=".search" onCancel={onClose}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="panel" data-budget style:--page-size={PAGE_SIZE} onkeydown={onKeydown}>
    <header>
      <span class="title">AUTOEQ LIBRARY</span>
      <span class="meta">{autoEqEntries().length} PROFILES &middot; {generatedDate}</span>
      <button class="chip hi" onclick={onClose} title="Close" aria-label="Close">&times;</button>
    </header>

    <div class="toolbar">
      <input
        class="search"
        type="text"
        placeholder="SEARCH&hellip;"
        bind:value={query}
        oninput={() => { page = 0; }}
      />
      <div class="scopes">
        <button type="button" class="chip" class:accent={scope === 'all'} class:hi={scope !== 'all'} onclick={() => setScope('all')}>ALL</button>
        <button type="button" class="chip" class:accent={scope === 'favs'} class:hi={scope !== 'favs'} onclick={() => setScope('favs')}>&#9733; FAVS</button>
        <button type="button" class="chip" class:accent={scope === 'user'} class:hi={scope !== 'user'} onclick={() => setScope('user')}>USER</button>
      </div>
    </div>

    <div class="list">
      {#if autoEqDb.status === 'loading'}
        <p class="hint pad">LOADING&hellip;</p>
      {:else if autoEqDb.status === 'error'}
        <p class="hint pad">{autoEqDb.error ?? 'FAILED TO LOAD'}</p>
        <button class="chip" onclick={() => ensureAutoEqDb()}>RETRY</button>
      {:else}
        {#each visible as e (e.id)}
          <div class="row" class:selected={selectedId === e.id}>
            <button
              type="button"
              class="fav"
              class:on={isAutoEqFavorite(e.id)}
              title="Toggle favorite"
              onclick={(ev) => onFav(ev, e.id)}
            >{isAutoEqFavorite(e.id) ? '★' : '☆'}</button>
            <button type="button" class="row-main" onclick={() => selectRow(e.id)}>
              <span class="name">{autoEqDisplayName(e)}</span>
              <span class="pill" data-src={sourceHue(e.source)}>{autoEqSourceLabel(e.source)}</span>
              <span class="fftag">{e.formFactor}</span>
            </button>
            {#if e.source === 'user'}
              <ConfirmButton label="DEL" confirmLabel="DEL?" tone="danger" extraClass="hi del"
                title="Delete this saved entry" onConfirm={() => onDelete(e.id)} />
            {/if}
          </div>
        {/each}
      {/if}
    </div>

    <div class="pager">
      <button type="button" class="pgbtn" aria-label="Previous page" title="Previous page (PageUp)" disabled={pageIdx === 0} onclick={() => goPage(-1)}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3L5 8l5 5" /></svg>
      </button>
      <span class="range" aria-live="polite">{rangeFrom}&ndash;{rangeTo} of {results.length}</span>
      <button type="button" class="pgbtn" aria-label="Next page" title="Next page (PageDown)" disabled={pageIdx >= pageCount - 1} onclick={() => goPage(1)}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>
      </button>
    </div>

    {#if selectedEntry}
      <div class="footer">
        <span class="hint">
          PREAMP {selectedEntry.preamp} dB &middot; {selectedBandCount} BANDS &middot; &rarr; {preampTargetLabel(channel)}
        </span>
        <div class="actions">
          <button class="chip accent" onclick={() => applyTo(false)}>APPLY &rarr; {shortName(selectedEntry)}</button>
          {#if hasTwin}
            <button class="chip accent" onclick={() => applyTo(true)}>APPLY PAIR</button>
          {/if}
        </div>
      </div>
    {/if}

    <div class="save">
      <input
        class="search"
        type="text"
        placeholder="SAVE CURRENT EQ AS&hellip;"
        bind:value={saveName}
      />
      <button class="chip" disabled={saveName.trim().length === 0} onclick={onSave}>SAVE</button>
    </div>
  </div>
</Modal>

<style>
  .panel {
    background: var(--panel-solid);
    border: 1px solid var(--border-hi);
    border-radius: var(--radius-m);
    width: 640px;
    max-width: 92vw;
    max-height: 80vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    color: var(--text);
    --row-h: 26px;
    --row-gap: 2px;
  }

  header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
  }
  .title {
    font-family: var(--font-sans);
    font-size: var(--fs-l);
    font-weight: 600;
    color: var(--text);
  }
  .meta {
    flex: 1;
    font-size: var(--fs-s);
    color: var(--text-faint);
    text-align: right;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
  }
  .search {
    flex: 1;
    background: var(--wash);
    border: 1px solid var(--border);
    border-radius: var(--radius-s);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.5px;
    padding: 5px 8px;
  }
  .scopes { display: flex; gap: 6px; }

  .list {
    flex: none;
    box-sizing: content-box;
    height: calc(var(--page-size) * (var(--row-h) + var(--row-gap)) - var(--row-gap));
    overflow: hidden;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: var(--row-gap);
  }
  .hint.pad { padding: 14px; }
  .pager {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    border-top: 1px solid var(--border);
    font-family: var(--font-mono);
    font-size: var(--fs-s);
    color: var(--text-dim);
  }
  .range { min-width: 84px; text-align: center; }
  .pgbtn {
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    padding: 0;
    border-radius: var(--radius-s);
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
  }
  .pgbtn:hover:not(:disabled) { color: var(--text); border-color: var(--border-hi); }
  .pgbtn:disabled { opacity: var(--dim-disabled); cursor: default; }

  .row {
    flex: none;
    height: var(--row-h);
    display: flex;
    align-items: center;
    gap: 6px;
    border-radius: var(--radius-s);
  }
  .row.selected {
    background: color-mix(in oklab, var(--accent) var(--tint), transparent);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--accent) var(--tint-edge), transparent) inset;
  }

  .fav {
    flex: none;
    width: 24px;
    height: 24px;
    border-radius: var(--radius-s);
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-faint);
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
  }
  .fav:hover { color: var(--text-dim); }
  .fav.on { color: var(--warn); }

  .row-main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 100%;
    padding: 0 6px;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-align: left;
    font-family: var(--font-mono);
  }
  .name {
    flex: 1;
    min-width: 0;
    font-size: 11px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pill {
    flex: none;
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.6px;
    padding: 2px 6px;
    border-radius: var(--radius-s);
    text-transform: uppercase;
    --hue: var(--text-faint);
    color: var(--hue);
    background: color-mix(in oklab, var(--hue) 14%, transparent);
    border: 1px solid color-mix(in oklab, var(--hue) 35%, transparent);
  }
  .pill[data-src="oratory"]       { --hue: oklch(74% 0.15 55); }
  .pill[data-src="crinacle"]      { --hue: oklch(70% 0.14 320); }
  .pill[data-src="rtings"]        { --hue: oklch(72% 0.13 250); }
  .pill[data-src="innerfidelity"] { --hue: oklch(74% 0.14 150); }
  .pill[data-src="user"]          { --hue: var(--accent); }
  .pill[data-src="other"]         { --hue: var(--text-faint); }

  .fftag {
    flex: none;
    font-size: 8px;
    letter-spacing: 0.6px;
    color: var(--text-faint);
    text-transform: uppercase;
  }

  .list :global(.del) { flex: none; }

  .footer {
    padding: 10px 14px;
    border-top: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .footer .hint { flex: 1; }
  .actions { display: flex; gap: 8px; }

  .save {
    display: flex;
    gap: 8px;
    padding: 10px 14px;
    border-top: 1px solid var(--border);
  }
</style>
