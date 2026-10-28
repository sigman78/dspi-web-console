<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { registerLayer } from './dismiss';

  const {
    onCancel,
    labelledBy,
    ariaLabel,
    initialFocus,
    children,
  }: {
    onCancel: () => void;
    labelledBy?: string;
    ariaLabel?: string;
    /** Selector for the element that takes focus on open; defaults to the first `[data-safe]` button, else the first button. */
    initialFocus?: string;
    children: Snippet;
  } = $props();

  const FOCUSABLE =
    'button:not(:disabled), input:not(:disabled):not([type=hidden]), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

  let root = $state<HTMLElement>();
  const opener = document.activeElement;

  onMount(() => {
    const target =
      (initialFocus ? root?.querySelector<HTMLElement>(initialFocus) : null) ??
      root?.querySelector<HTMLElement>('button[data-safe]') ??
      root?.querySelector<HTMLElement>('button');
    target?.focus();
    const unregister = registerLayer((e) => {
      e.preventDefault();
      onCancel();
    });
    return () => {
      unregister();
      if (opener instanceof HTMLElement) opener.focus();
    };
  });

  function onKey(e: KeyboardEvent) {
    if (e.defaultPrevented || e.key !== 'Tab' || !root) return;
    const items = root.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const cur = document.activeElement;
    if (e.shiftKey && (cur === first || !root.contains(cur))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (cur === last || !root.contains(cur))) { e.preventDefault(); first.focus(); }
  }

  function onScrimClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onCancel();
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="scrim"
  bind:this={root}
  role="dialog"
  aria-modal="true"
  aria-labelledby={labelledBy}
  aria-label={ariaLabel}
  tabindex="-1"
  onclick={onScrimClick}
>
  {@render children()}
</div>

<style>
  .scrim {
    position: fixed; inset: 0;
    background: var(--scrim);
    backdrop-filter: blur(6px);
    display: grid; place-items: center;
    z-index: var(--z-modal);
    font-family: var(--font-mono);
  }
</style>
