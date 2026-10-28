<script lang="ts">
  const {
    label,
    value,
    tone,
    title,
    wide = false,
    inline = false,
  }: {
    label: string;
    value: string;
    tone?: 'ok' | 'off' | 'warn';
    title?: string;
    // Span every column of the parent grid and wrap long tokens (build stamps).
    wide?: boolean;
    inline?: boolean;
  } = $props();
</script>

<div class="kv" {title} class:help={title != null} class:wide={wide && !inline} class:inline>
  <div class="lbl">{label}</div>
  <div class="val" class:ok={tone === 'ok'} class:off={tone === 'off'} class:warn={tone === 'warn'}>{value}</div>
</div>

<style>
  .kv.help { cursor: help; }
  .kv.wide { grid-column: 1 / -1; min-width: 0; }
  .kv.wide .val { overflow-wrap: anywhere; }
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
