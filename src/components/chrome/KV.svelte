<script lang="ts">
  import type { Snippet } from 'svelte';

  const {
    label,
    value,
    tone,
    title,
    inline = false,
    children,
  }: {
    label: string;
    value: string;
    tone?: 'ok' | 'off' | 'warn';
    title?: string;
    inline?: boolean;
    /** Replaces the plain value, e.g. with an inline editor. */
    children?: Snippet;
  } = $props();
</script>

<div class="kv" {title} class:help={title != null} class:inline>
  <div class="lbl">{label}</div>
  <div class="val" class:ok={tone === 'ok'} class:off={tone === 'off'} class:warn={tone === 'warn'}>{#if children}{@render children()}{:else}{value}{/if}</div>
</div>

<style>
  .kv.help { cursor: help; }
  .kv.inline {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 22px;
    padding: 0 14px;
    box-sizing: border-box;
  }
  .kv.inline:not(:first-child) { border-top: 1px solid var(--wash); }
  .kv.inline .val { margin-top: 0; font-size: 12px; text-align: right; overflow-wrap: anywhere; }
  .lbl {
    font-family: var(--font-sans);
    font-size: var(--fs-m);
    color: var(--text-dim);
  }
  .val {
    font-family: var(--font-mono);
    font-size: var(--fs-l);
    font-weight: 600;
    color: var(--text);
    margin-top: 2px;
  }
  .val.ok { color: var(--ok); }
  .val.off { color: var(--text-faint); }
  .val.warn { color: var(--warn); }
</style>
