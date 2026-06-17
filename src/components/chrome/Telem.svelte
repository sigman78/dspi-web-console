<script lang="ts">
  const {
    label,
    value,
    bar,
    priority = 'static',
  }: {
    label: string;
    value: string;
    bar?: number;
    priority?: 'health' | 'static';
  } = $props();
</script>

<div class="telem prio-{priority}">
  <div class="lbl">{label}</div>
  <div class="val">{value}</div>
  {#if bar !== undefined}
    <div class="track">
      <div class="fill" class:hot={bar > 0.8} style:width="{Math.max(0, Math.min(1, bar)) * 100}%"></div>
    </div>
  {/if}
</div>

<style>
  .telem {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 38px;
    font-family: var(--font-mono);
  }
  .lbl { font-size: 9px; color: var(--text-faint); letter-spacing: 1px; }
  .val { font-size: 11px; color: var(--text); font-weight: 600; }
  .track {
    height: 2px;
    background: color-mix(in oklab, var(--text) 8%, transparent);
    border-radius: 1px;
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--accent);
    border-radius: 1px;
    transition: width 200ms;
  }
  .fill.hot { background: var(--err); }
</style>
