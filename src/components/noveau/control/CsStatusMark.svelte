<script lang="ts">
  const { pill }: { pill: { text: string; cls: string; tip?: string } } = $props();
  const mark = $derived(pill.cls === 'ok' || pill.cls === 'idle');
  const label = $derived(pill.tip ?? pill.text.charAt(0) + pill.text.slice(1).toLowerCase());
</script>

{#if mark}
  <span class="mark {pill.cls}" role="img" title={label} aria-label={label}>
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="1.5,5.5 4,8 8.5,2" />
    </svg>
  </span>
{:else}
  <span class="cs-pill {pill.cls}">{pill.text}</span>
{/if}

<style>
  .mark { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 16px; }
  .mark.ok { color: var(--ok); }
  .mark.idle { color: var(--text-faint); }
</style>
