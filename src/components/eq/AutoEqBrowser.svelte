<script lang="ts">
  import { onMount } from 'svelte';
  import {
    type ChannelModel, type AutoEqEntry,
    FilterType, groupIntoPairs, autoEqDisplayName, autoEqSourceLabel, autoEqFiltersToBands,
  } from '@/domain';
  import {
    autoEqDb, ensureAutoEqDb, isAutoEqFavorite, toggleAutoEqFavorite,
    saveAutoEqUserEntry, deleteAutoEqUserEntry, searchAutoEq,
  } from '@/state';
  import { applyAutoEqEntry, preampTargetLabel } from '@/runtime';
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
  let searchInput: HTMLInputElement | null = $state(null);

  $effect(() => {
    searchInput?.focus();
  });

  const LIST_MAX = 250;

  const results = $derived(searchAutoEq(query, scope));
  const visible = $derived(results.slice(0, LIST_MAX));
  const overflow = $derived(Math.max(0, results.length - LIST_MAX));

  const allEntries = $derived(searchAutoEq('', 'all'));
  const selectedEntry = $derived(allEntries.find((e) => e.id === selectedId) ?? null);

  const generatedDate = $derived(autoEqDb.generatedAt?.split('T')[0] ?? '');

  const hasTwin = $derived.by(() => {
    const chans = s.mirror.current?.channels;
    if (!chans) return false;
    return groupIntoPairs(chans).some(
      (g) => g.members.length === 2 && g.members.some((c) => c.id === channel.id),
    );
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

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }

  function selectRow(id: string) {
    selectedId = id;
  }

  function onFav(e: MouseEvent, id: string) {
    e.stopPropagation();
    toggleAutoEqFavorite(id);
  }

  function onDelete(e: MouseEvent, id: string) {
    e.stopPropagation();
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
    scope = 'user';
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="scrim">
  <button class="scrim-close" aria-label="Close AutoEQ library" onclick={onClose}></button>
  <div
    class="panel"
    role="dialog"
    aria-modal="true"
    aria-label="AutoEQ library"
  >
    <header>
      <span class="title">AUTOEQ LIBRARY</span>
      <span class="meta">{autoEqDb.entries.length} PROFILES &middot; {generatedDate}</span>
      <button class="chip hi" onclick={onClose} title="Close" aria-label="Close">&times;</button>
    </header>

    <div class="toolbar">
      <input
        class="search"
        type="text"
        placeholder="SEARCH&hellip;"
        bind:value={query}
        bind:this={searchInput}
      />
      <div class="scopes">
        <button type="button" class="chip" class:accent={scope === 'all'} class:hi={scope !== 'all'} onclick={() => (scope = 'all')}>ALL</button>
        <button type="button" class="chip" class:accent={scope === 'favs'} class:hi={scope !== 'favs'} onclick={() => (scope = 'favs')}>&#9733; FAVS</button>
        <button type="button" class="chip" class:accent={scope === 'user'} class:hi={scope !== 'user'} onclick={() => (scope = 'user')}>USER</button>
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
              <button
                type="button"
                class="chip hi danger del"
                title="Delete this saved entry"
                onclick={(ev) => onDelete(ev, e.id)}
              >DEL</button>
            {/if}
          </div>
        {/each}
        {#if overflow > 0}
          <p class="hint overflow">&hellip; {overflow} MORE &mdash; REFINE SEARCH</p>
        {/if}
      {/if}
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
</div>

<style>
  .scrim {
    position: fixed; inset: 0;
    background: color-mix(in oklab, var(--bg) 70%, transparent);
    backdrop-filter: blur(6px);
    display: grid; place-items: center;
    z-index: 1000;
    font-family: var(--font-mono);
  }
  .scrim-close {
    position: absolute;
    inset: 0;
    border: none;
    background: transparent;
    padding: 0;
    cursor: default;
  }
  .panel {
    position: relative;
    z-index: 1;
    background: var(--panel-solid);
    border: 1px solid var(--border-hi);
    border-radius: 6px;
    width: 640px;
    max-width: 92vw;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    color: var(--text);
  }

  header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
  }
  .title {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1.5px;
    color: var(--text);
  }
  .meta {
    flex: 1;
    font-size: 9px;
    letter-spacing: 1px;
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
    border-radius: 4px;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.5px;
    padding: 5px 8px;
  }
  .search:focus { outline: none; border-color: var(--border-hi); }
  .scopes { display: flex; gap: 6px; }

  .list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 6px;
  }
  .hint.pad { padding: 14px; }
  .hint.overflow { padding: 8px 14px; text-align: center; }

  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    border-radius: 4px;
    margin-bottom: 2px;
  }
  .row.selected {
    background: color-mix(in oklab, var(--accent) 12%, transparent);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--accent) 45%, transparent) inset;
  }

  .fav {
    flex: none;
    width: 24px;
    height: 24px;
    border-radius: 4px;
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
    padding: 6px 6px;
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
    border-radius: 3px;
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

  .del { flex: none; }

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
