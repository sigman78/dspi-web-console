<script lang="ts">
  import { getSession } from '@/components/sessionContext';
  import { destinations } from './destinations';
  import { noveauUi } from './noveauUi.svelte';

  const s = getSession();
  const items = $derived(destinations(s.device.capabilities.features));
</script>

<nav class="irail" aria-label="Destinations" data-budget>
  {#each items as it (it.key)}
    <button
      type="button"
      class="ib"
      class:on={noveauUi.destination === it.key}
      class:push={it.key === 'about'}
      aria-current={noveauUi.destination === it.key ? 'page' : undefined}
      onclick={() => {
        noveauUi.destination = it.key;
        noveauUi.presetsOpen = false;
      }}
    >
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
        {#if it.key === 'tune'}
          <path d="M3 5h14M3 10h14M3 15h14" /><circle cx="7" cy="5" r="1.8" /><circle cx="13" cy="10" r="1.8" /><circle cx="8" cy="15" r="1.8" />
        {:else if it.key === 'program'}
          <rect x="2" y="7" width="4" height="6" rx="1" /><rect x="8" y="7" width="4" height="6" rx="1" /><rect x="14" y="7" width="4" height="6" rx="1" /><path d="M6 10h2M12 10h2" />
        {:else if it.key === 'setup'}
          <rect x="5" y="5" width="10" height="10" rx="1.5" /><path d="M8 2.5v2.5M12 2.5v2.5M8 15v2.5M12 15v2.5M2.5 8H5M2.5 12H5M15 8h2.5M15 12h2.5" />
        {:else if it.key === 'control'}
          <circle cx="10" cy="10" r="6" /><path d="M10 10 6.5 5.8" />
        {:else}
          <circle cx="10" cy="10" r="7.5" /><path d="M10 6.5h.01" /><path d="M10 9v5" />
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
    background: var(--surface-chrome);
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
  .ib span { font-family: var(--font-sans); font-size: var(--fs-xs); font-weight: 500; }
  .ib.on { color: var(--text); background: color-mix(in oklab, var(--accent) var(--tint), transparent); }
  .ib.on svg { stroke: var(--accent); }
  .ib.on::before {
    content: "";
    position: absolute;
    left: 0; top: 6px; bottom: 6px;
    width: 3px;
    border-radius: 0 var(--radius-xs) var(--radius-xs) 0;
    background: var(--accent);
  }
  .ib.push { margin-top: auto; }
</style>
