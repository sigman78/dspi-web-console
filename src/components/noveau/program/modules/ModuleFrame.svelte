<script lang="ts">
  import type { Snippet } from 'svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';

  const {
    title,
    pass,
    blurb,
    enabled,
    onEnable,
    reason,
    children,
  }: {
    title: string;
    pass: string;
    blurb: string;
    /** Omitted for modules without an enable state; false shows an "off" tag. */
    enabled?: boolean;
    /** Header enable switch; needs `enabled`. */
    onEnable?: (v: boolean) => void;
    /** Why the module is off; shown as one line above the body. Sub-gated controls explain themselves. */
    reason?: string;
    children: Snippet;
  } = $props();
</script>

<section class="mf">
  <header class="sec-h">
    <h3>{title}</h3>
    <span class="cap" title={pass}>{pass}</span>
    {#if enabled === false && !onEnable}<span class="t-cap off">off</span>{/if}
    {#if onEnable && enabled !== undefined}
      <span class="en"><ToggleSwitch checked={enabled} ariaLabel={`Enable ${title}`} onChange={onEnable} /></span>
    {/if}
  </header>
  <p class="t-cap blurb">{blurb}</p>
  {#if reason}<p class="hint reason" title={reason}>{reason}</p>{/if}
  <div class="body">{@render children()}</div>
</section>

<style>
  .mf { display: flex; flex-direction: column; min-width: 0; min-height: 0; height: 100%; overflow: hidden; }
  .sec-h { flex: none; }
  .blurb { margin: 0 0 8px; padding: 0 4px; line-height: 1.35; }
  .off { flex: none; }
  .en { flex: none; margin-left: 8px; }
  .reason { flex: none; padding: 0 4px; margin: 0 0 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .body { flex: 1 1 auto; min-height: 0; overflow: hidden; }
  .mf :global(.jump) {
    width: 20px; height: 20px; padding: 0; flex: 0 0 auto;
    display: inline-flex; align-items: center; justify-content: center;
    background: transparent; border: none; border-radius: var(--radius-s); cursor: pointer;
    font-family: var(--font-sans); font-size: var(--fs-xl); line-height: 1; color: var(--text-dim);
  }
  .mf :global(.jump:hover), .mf :global(.jump:focus-visible) { color: var(--accent); }
</style>
