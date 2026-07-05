<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import { LATEST_CHANGES } from '@/changelog';
</script>

<Panel code="OV.06" title="LATEST CHANGES">
  {#snippet right()}
    <span class="meta">v{LATEST_CHANGES.version}</span>
  {/snippet}
  <ul class="list">
    {#each LATEST_CHANGES.highlights as line (line)}
      <li>{line}</li>
    {/each}
  </ul>
</Panel>

<style>
  .meta { font-family: var(--font-mono); font-size: 9px; color: var(--text-faint); letter-spacing: 1px; }
  .list {
    margin: 0;
    padding: 12px 14px;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .list li {
    font-family: var(--font-sans);
    font-size: 12px;
    color: var(--text-dim);
    line-height: 1.5;
    padding-left: 14px;
    position: relative;
  }
  .list li::before {
    content: '▸';
    position: absolute;
    left: 0;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: 10px;
    top: 2px;
  }
</style>
