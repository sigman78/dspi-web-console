<script lang="ts">
  const {
    label,
    value,
    tone,
    title,
    wide = false,
  }: {
    label: string;
    value: string;
    tone?: 'ok' | 'off' | 'warn';
    title?: string;
    // Span every column of the parent grid and wrap long tokens (build stamps).
    wide?: boolean;
  } = $props();
</script>

<div class="kv" {title} class:help={title != null} class:wide>
  <div class="lbl">{label}</div>
  <div class="val" class:ok={tone === 'ok'} class:off={tone === 'off'} class:warn={tone === 'warn'}>{value}</div>
</div>

<style>
  .kv { font-family: var(--font-mono); }
  .kv.help { cursor: help; }
  .kv.wide { grid-column: 1 / -1; min-width: 0; }
  .kv.wide .val { overflow-wrap: anywhere; }
  .lbl {
    font-size: 9px;
    color: var(--text-faint);
    letter-spacing: 1.2px;
    text-transform: uppercase;
  }
  .val {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
    margin-top: 2px;
  }
  .val.ok { color: var(--ok); }
  .val.off { color: var(--text-faint); }
  .val.warn { color: var(--warn); }
</style>
