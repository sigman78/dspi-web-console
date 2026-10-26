<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import { LATEST_CHANGES } from '@/changelog';
  import { REPO_URL } from '@/buildInfo';

  const { limit }: { limit?: number } = $props();
  const lines = $derived(limit == null ? LATEST_CHANGES.highlights : LATEST_CHANGES.highlights.slice(0, limit));
  const truncated = $derived(lines.length < LATEST_CHANGES.highlights.length);
</script>

<Panel code="OV.06" title="LATEST CHANGES">
  {#snippet right()}
    <span class="meta">v{LATEST_CHANGES.version}</span>
  {/snippet}
  <ul class="list">
    {#each lines as line (line)}
      <li>{line}</li>
    {/each}
  </ul>
  {#if truncated}
    <a class="more" href={`${REPO_URL}/blob/master/CHANGELOG.md`} target="_blank" rel="noreferrer">full changelog →</a>
  {/if}
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
  .more { display: block; padding: 0 14px 12px; font-size: 11px; color: var(--accent); text-decoration: none; }
  .more:hover { text-decoration: underline; }
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
