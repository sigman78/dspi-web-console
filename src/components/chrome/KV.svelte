<script lang="ts">
  const {
    label,
    value,
    tone,
    title,
  }: {
    label: string;
    value: string;
    tone?: 'ok' | 'off' | 'warn';
    title?: string;
  } = $props();
</script>

<div class="kv" {title} class:help={title != null}>
  <div class="lbl">{label}</div>
  <div class="val" class:ok={tone === 'ok'} class:off={tone === 'off'} class:warn={tone === 'warn'}>{value}</div>
</div>

<style>
  .kv { font-family: var(--font-mono); }
  .kv.help { cursor: help; }
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
