<script lang="ts">
  const {
    label,
    value,
    tone,
  }: {
    label: string;
    value: string;
    tone?: 'ok' | 'off';
  } = $props();
</script>

<div class="kv">
  <div class="lbl">{label}</div>
  <div class="val" class:ok={tone === 'ok'} class:off={tone === 'off'}>{value}</div>
</div>

<style>
  .kv { font-family: var(--font-mono); }
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
</style>
