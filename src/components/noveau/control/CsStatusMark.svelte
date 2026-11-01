<script lang="ts">
  // Fixed 16px status glyph so the column lines up across every CS list.
  const { pill }: { pill: { text: string; cls: string; tip?: string } } = $props();
  const kind = $derived(['ok', 'idle', 'new', 'run', 'warn'].includes(pill.cls) ? pill.cls : 'off');
  const label = $derived(pill.tip ?? pill.text.charAt(0) + pill.text.slice(1).toLowerCase());
</script>

<span class="mark {kind}" role="img" title={label} aria-label={label}>
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {#if kind === 'ok' || kind === 'idle'}
      <polyline points="1.5,5.5 4,8 8.5,2" />
    {:else if kind === 'new'}
      <circle cx="5" cy="5" r="3" fill="currentColor" stroke="none" />
    {:else if kind === 'run'}
      <polygon points="2.5,1.5 8.5,5 2.5,8.5" fill="currentColor" />
    {:else if kind === 'warn'}
      <line x1="5" y1="1.5" x2="5" y2="5" />
      <circle cx="5" cy="8.5" r="1" fill="currentColor" stroke="none" />
    {:else}
      <circle cx="5" cy="5" r="3.2" stroke-width="1.4" />
    {/if}
  </svg>
</span>

<style>
  .mark { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 16px; }
  .mark.ok { color: var(--ok); }
  .mark.new, .mark.run { color: var(--accent); }
  .mark.warn { color: var(--warn); }
  .mark.idle, .mark.off { color: var(--text-faint); }
</style>
