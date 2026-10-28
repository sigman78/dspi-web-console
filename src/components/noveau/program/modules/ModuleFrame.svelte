<script lang="ts">
  import type { Snippet } from 'svelte';

  const {
    title,
    pass,
    blurb,
    enabled,
    children,
  }: {
    title: string;
    pass: string;
    /** Shown as the title tooltip. */
    blurb: string;
    /** Omitted for modules without an enable state; false washes the body and makes it inert. The strip tile owns the switch. */
    enabled?: boolean;
    children: Snippet;
  } = $props();
</script>

<section class="mf">
  <header class="sec-h">
    <h3 title={blurb}>{title}</h3>
    <span class="cap" title={pass}>{pass}</span>
  </header>
  <div class="body" class:off={enabled === false}>{@render children()}</div>
</section>

<style>
  .mf { display: flex; flex-direction: column; width: var(--module-col); max-width: 100%; min-width: 0; min-height: 0; height: 100%; overflow: hidden; }
  .sec-h { flex: none; }
  .body { flex: 1 1 auto; min-height: 0; overflow: hidden; }
  /* Off: one wash on the whole body; controls inside keep full contrast so it does not compound with their own disabled dim. */
  .body.off { opacity: var(--dim-off); pointer-events: none; }
  .body.off :global(:disabled), .body.off :global([aria-disabled='true']) { opacity: 1; }
  .mf :global(.jump) {
    width: 20px; height: 20px; padding: 0; flex: 0 0 auto;
    display: inline-flex; align-items: center; justify-content: center;
    background: transparent; border: none; border-radius: var(--radius-s); cursor: pointer;
    font-family: var(--font-sans); font-size: var(--fs-xl); line-height: 1; color: var(--text-dim);
  }
  .mf :global(.jump:hover), .mf :global(.jump:focus-visible) { color: var(--accent); }
</style>
