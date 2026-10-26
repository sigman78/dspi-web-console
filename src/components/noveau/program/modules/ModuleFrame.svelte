<script lang="ts">
  import type { Snippet } from 'svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';

  const {
    title,
    pass,
    enabled,
    onToggle,
    children,
  }: {
    title: string;
    pass: string;
    /** Omitted for modules without an enable switch. */
    enabled?: boolean;
    onToggle?: (v: boolean) => void;
    children: Snippet;
  } = $props();
</script>

<section class="mf">
  <header>
    <h3>{title}</h3>
    <span class="pass" title={pass}>{pass}</span>
    {#if enabled !== undefined && onToggle}
      <span class="en">
        <span class="enl">ENABLED</span>
        <ToggleSwitch size="sm" checked={enabled} ariaLabel={`${title} enabled`} onChange={onToggle} />
      </span>
    {/if}
  </header>
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
  .en { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 8px; }
  .enl { font-family: var(--font-sans); font-size: 11px; color: var(--text-dim); }
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
  .mf :global(.vf[data-size='md']) { height: 22px; font-size: 12px; }
  .mf :global(.chip) { height: 20px; font-size: 11px; padding: 0 8px; }
  .mf :global(.opt) { font-size: 11px; }
</style>
