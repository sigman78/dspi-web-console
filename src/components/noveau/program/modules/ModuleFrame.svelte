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
    blurb: string;
    /** Omitted for modules without an enable state; false shows an "off" tag. */
    enabled?: boolean;
    children: Snippet;
  } = $props();
</script>

<section class="mf">
  <header>
    <h3>{title}</h3>
    <span class="pass" title={pass}>{pass}</span>
    {#if enabled === false}<span class="off">off</span>{/if}
  </header>
  <p class="blurb">{blurb}</p>
  <div class="body">{@render children()}</div>
</section>

<style>
  .mf { display: flex; flex-direction: column; min-width: 0; min-height: 0; height: 100%; overflow: hidden; }
  header {
    flex: 0 0 28px;
    height: 28px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 4px;
    min-width: 0;
  }
  h3 { margin: 0; flex: 0 0 auto; font-family: var(--font-sans); font-size: 12px; font-weight: 600; color: var(--text); }
  .pass {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-sans);
    font-size: 11px;
    color: var(--text-dim);
  }
  .blurb { margin: 0 0 8px; padding: 0 4px; font-family: var(--font-sans); font-size: 11px; line-height: 1.35; color: var(--text-dim); }
  .off { flex: 0 0 auto; font-family: var(--font-sans); font-size: 11px; color: var(--text-faint); }
  .body { flex: 1 1 auto; min-height: 0; overflow: hidden; }

  .mf :global(.r) {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 24px;
    border-top: 1px solid var(--border);
    min-width: 0;
    --rf-track: 140px;
  }
  .mf :global(.r.sub) { font-family: var(--font-sans); font-size: 11px; font-weight: 600; color: var(--text); }
  .mf :global(.lbl) {
    flex: 0 0 84px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-sans);
    font-size: 11px;
    color: var(--text-dim);
  }
  .mf :global(.ctl) { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .mf :global(.fld) { flex: 0 0 72px; }
  .mf :global(.mono) { font-family: var(--font-mono); font-size: 12px; color: var(--text); }
  .mf :global(.note) { font-family: var(--font-sans); font-size: 11px; color: var(--text-faint); white-space: nowrap; }
  .mf :global(.vf) { height: 22px; font-size: 12px; }
  .mf :global(.chip) { height: 20px; font-size: 11px; padding: 0 8px; }
  .mf :global(.r .seg) { height: 18px; align-items: stretch; }
  .mf :global(.r .seg.sm .opt) { display: flex; align-items: center; justify-content: center; font-size: 11px; padding-top: 0; padding-bottom: 0; }
  .mf :global(.jump) {
    width: 20px; height: 20px; padding: 0; flex: 0 0 auto;
    display: inline-flex; align-items: center; justify-content: center;
    background: transparent; border: none; border-radius: 3px; cursor: pointer;
    font-family: var(--font-sans); font-size: 14px; line-height: 1; color: var(--text-dim);
  }
  .mf :global(.jump:hover), .mf :global(.jump:focus-visible) { color: var(--accent); }
</style>
