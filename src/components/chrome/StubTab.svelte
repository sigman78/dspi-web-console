<script lang="ts">
  import Panel from './Panel.svelte';

  const {
    title,
    code,
    breadcrumb,
    bullets,
  }: {
    title: string;
    code: string;
    breadcrumb: 'eq-state' | 'processing-edit' | 'bode-render' | 'persist';
    bullets: string[];
  } = $props();
</script>

<Panel {code} {title}>
  {#snippet right()}
    <span class="tag">NOT YET IMPLEMENTED</span>
  {/snippet}
  <div class="body">
    <p class="lead">
      Outline of intended UI. Implementation pending under TODO breadcrumb
      <code>{breadcrumb}</code>
    </p>
    <ul>
      {#each bullets as item, i (i)}<li>{item}</li>{/each}
    </ul>
  </div>
</Panel>

<style>
  .body { padding: 16px 18px; font-family: var(--font-sans); color: var(--text-dim); font-size: 12px; }
  .lead { margin: 0 0 12px; }
  ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; }
  li::marker { color: var(--text-faint); }
  code {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--accent);
    background: color-mix(in oklab, var(--accent) 8%, transparent);
    padding: 1px 4px;
    border-radius: 3px;
  }
  .tag {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 1px;
    color: var(--warn);
    border: 1px solid color-mix(in oklab, var(--warn) 40%, transparent);
    background: color-mix(in oklab, var(--warn) 8%, transparent);
    padding: 2px 6px;
    border-radius: 3px;
  }
</style>
