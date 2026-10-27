<script lang="ts">
  import { onMount } from 'svelte';
  import { FilterType } from '@/domain';
  import { clampToBounds, dismiss } from '@/components/chrome/dismiss';
  import { TYPE_LABELS } from '@/components/eq/BandTypeSelect.svelte';

  const {
    x,
    y,
    boundsW,
    boundsH,
    type,
    bypassed,
    types,
    onType,
    onBypass,
    onClear,
    onClose,
  }: {
    /** Anchor point and the box it must stay inside, in the same coordinates. */
    x: number;
    y: number;
    boundsW: number;
    boundsH: number;
    type: FilterType;
    bypassed: boolean;
    types: FilterType[];
    onType: (t: FilterType) => void;
    onBypass: () => void;
    onClear: () => void;
    onClose: () => void;
  } = $props();

  let el = $state<HTMLDivElement | null>(null);
  let w = $state(0);
  let h = $state(0);
  const pos = $derived(clampToBounds(x, y, w, h, boundsW, boundsH));

  const opener = document.activeElement;

  onMount(() => {
    items()[0]?.focus();
    return () => {
      const active = document.activeElement;
      const lost = !active || active === document.body || el?.contains(active);
      if (lost && opener instanceof HTMLElement) opener.focus();
    };
  });

  const items = (): HTMLButtonElement[] => Array.from(el?.querySelectorAll('button') ?? []);

  function onKey(e: KeyboardEvent) {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (e.key === 'ArrowDown') next = (at + 1) % list.length;
    else if (e.key === 'ArrowUp') next = (at <= 0 ? list.length : at) - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    else return;
    e.preventDefault();
    list[next]?.focus();
  }

  function pick(fn: () => void) {
    fn();
    onClose();
  }
</script>

<div
  class="menu"
  bind:this={el}
  bind:offsetWidth={w}
  bind:offsetHeight={h}
  role="menu"
  tabindex="-1"
  style:left="{pos.left}px"
  style:top="{pos.top}px"
  use:dismiss={{ onDismiss: onClose }}
  onkeydown={onKey}
>
  {#each types.filter((t) => t !== FilterType.Flat) as t (t)}
    <button type="button" role="menuitemradio" tabindex="-1" aria-checked={t === type} class:cur={t === type} onclick={() => pick(() => onType(t))}>
      {TYPE_LABELS[t]}
    </button>
  {/each}
  <hr />
  <button type="button" role="menuitem" tabindex="-1" onclick={() => pick(onBypass)}>{bypassed ? 'Unbypass' : 'Bypass'}</button>
  <button type="button" role="menuitem" tabindex="-1" onclick={() => pick(onClear)}>Clear band</button>
</div>

<style>
  .menu {
    position: absolute;
    z-index: var(--z-pop);
    min-width: 132px;
    padding: 4px;
    display: flex;
    flex-direction: column;
    background: var(--panel-solid);
    border: 1px solid var(--border-hi);
    border-radius: var(--radius-s);
    box-shadow: var(--shadow-pop);
    font-family: var(--font-sans);
    font-size: 12px;
  }
  button {
    height: 24px;
    padding: 0 8px;
    text-align: left;
    background: none;
    border: none;
    border-radius: var(--radius-s);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  button:hover { background: var(--wash-strong); }
  button.cur { color: var(--accent); }
  hr { margin: 3px 0; border: none; border-top: 1px solid var(--border); }
</style>
