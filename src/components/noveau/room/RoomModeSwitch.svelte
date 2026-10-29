<script lang="ts">
  import type { RoomMode } from '@/state/settings.svelte';

  const { mode, onchange }: { mode: RoomMode; onchange: (m: RoomMode) => void } = $props();

  const MODES: readonly { key: RoomMode; label: string }[] = [
    { key: 'spectrum', label: 'Spectrum' },
    { key: 'vu-in', label: 'Input meters' },
    { key: 'vu-out', label: 'Output meters' },
  ];

  const buttons: HTMLButtonElement[] = [];

  function onkeydown(e: KeyboardEvent, i: number): void {
    let next: number;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (i + 1) % MODES.length;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (i + MODES.length - 1) % MODES.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = MODES.length - 1;
    else return;
    e.preventDefault();
    onchange(MODES[next].key);
    buttons[next]?.focus();
  }
</script>

<div class="modes" role="radiogroup" aria-label="Room view">
  {#each MODES as m, i (m.key)}
    <button
      type="button"
      role="radio"
      aria-checked={mode === m.key}
      aria-label={m.label}
      title={m.label}
      tabindex={mode === m.key ? 0 : -1}
      bind:this={buttons[i]}
      onclick={() => onchange(m.key)}
      onkeydown={(e) => onkeydown(e, i)}
    >
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
        {#if m.key === 'spectrum'}
          <path d="M4 19V13M9 19V6M14 19V10M19 19V4" /><path d="M2.5 20.5h19" />
        {:else if m.key === 'vu-in'}
          <path d="M2 13h5" /><path d="M5 10.5 7 13 5 15.5" />
          <rect x="10" y="5" width="4" height="15" rx="1" /><rect x="16" y="9" width="4" height="11" rx="1" />
          <path d="M8 20.5h14" />
        {:else}
          <rect x="4" y="5" width="4" height="15" rx="1" /><rect x="10" y="9" width="4" height="11" rx="1" />
          <path d="M2 20.5h14" />
          <path d="M16 13h5" /><path d="M19 10.5 21 13 19 15.5" />
        {/if}
      </svg>
    </button>
  {/each}
</div>

<style>
  .modes { flex: none; display: flex; flex-direction: column; gap: 6px; }
  button {
    width: 44px;
    height: 44px;
    padding: 0;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 12px;
    background: var(--wash);
    box-shadow: inset 0 0 0 1px var(--border-hi);
    color: var(--text-dim);
    cursor: pointer;
  }
  button[aria-checked='true'] {
    background: color-mix(in oklab, var(--accent) 22%, transparent);
    color: var(--accent);
  }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
