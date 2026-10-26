<script lang="ts">
  import { noveauUi, type NoveauDestination } from './noveauUi.svelte';

  const items: { key: NoveauDestination | 'library'; label: string }[] = [
    { key: 'tune', label: 'TUNE' },
    { key: 'program', label: 'PROGRAM' },
    { key: 'setup', label: 'SETUP' },
    { key: 'library', label: 'LIBRARY' },
    { key: 'device', label: 'DEVICE' },
  ];
</script>

<nav class="irail" aria-label="Destinations">
  {#each items as it (it.key)}
    <button
      type="button"
      class="ib"
      class:on={it.key === 'library' ? noveauUi.libraryOpen : noveauUi.destination === it.key}
      class:push={it.key === 'device'}
      data-library-toggle={it.key === 'library' ? '' : undefined}
      aria-pressed={it.key === 'library' ? noveauUi.libraryOpen : undefined}
      aria-current={it.key !== 'library' && noveauUi.destination === it.key ? 'page' : undefined}
      onclick={() => {
        if (it.key === 'library') noveauUi.libraryOpen = !noveauUi.libraryOpen;
        else {
          noveauUi.destination = it.key;
          noveauUi.libraryOpen = false;
        }
      }}
    >
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
        {#if it.key === 'tune'}
          <path d="M3 5h14M3 10h14M3 15h14" /><circle cx="7" cy="5" r="1.8" /><circle cx="13" cy="10" r="1.8" /><circle cx="8" cy="15" r="1.8" />
        {:else if it.key === 'program'}
          <rect x="2" y="7" width="4" height="6" rx="1" /><rect x="8" y="7" width="4" height="6" rx="1" /><rect x="14" y="7" width="4" height="6" rx="1" /><path d="M6 10h2M12 10h2" />
        {:else if it.key === 'setup'}
          <rect x="5" y="5" width="10" height="10" rx="1.5" /><path d="M8 2.5v2.5M12 2.5v2.5M8 15v2.5M12 15v2.5M2.5 8H5M2.5 12H5M15 8h2.5M15 12h2.5" />
        {:else if it.key === 'library'}
          <rect x="3" y="4" width="3.5" height="12" rx=".8" /><rect x="8" y="4" width="3.5" height="12" rx=".8" /><path d="M13.5 5.5l3-.8 2.4 10.6-3 .8z" />
        {:else}
          <path d="M10 3v9" /><path d="M7 12h6v2.5a3 3 0 01-6 0z" /><path d="M8 3h4" /><path d="M10 17.5v-1" />
        {/if}
      </svg>
      <span>{it.label}</span>
    </button>
  {/each}
</nav>

<style>
  .irail {
    display: flex;
    flex-direction: column;
    padding: 8px 0;
    border-right: 1px solid var(--border);
    background: color-mix(in oklab, var(--bg) 85%, var(--text) 3%);
    overflow: hidden;
  }
  .ib {
    position: relative;
    height: 52px;
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 0;
    background: none;
    border: none;
    color: var(--text-faint);
    cursor: pointer;
  }
  .ib:hover { color: var(--text-dim); }
  .ib svg {
    stroke: currentColor;
    fill: none;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .ib span { font-family: var(--font-mono); font-size: 9px; font-weight: 500; letter-spacing: 0.04em; }
  .ib.on { color: var(--text); background: color-mix(in oklab, var(--accent) 14%, transparent); }
  .ib.on svg { stroke: var(--accent); }
  .ib.on::before {
    content: "";
    position: absolute;
    left: 0; top: 6px; bottom: 6px;
    width: 3px;
    border-radius: 0 2px 2px 0;
    background: var(--accent);
  }
  .ib.push { margin-top: auto; }
</style>
