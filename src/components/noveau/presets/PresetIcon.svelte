<script lang="ts">
  const { icon }: { icon: 'save' | 'revert' } = $props();
</script>

<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if icon === 'save'}
    <rect x="2" y="2" width="12" height="12" rx="1.5" />
    <rect x="5" y="2" width="5" height="3.5" />
    <rect x="4.5" y="9" width="7" height="5" />
  {:else}
    <path d="M3 8a5 5 0 1 0 1.6-3.7" />
    <path d="M3 2.5v3h3" />
  {/if}
</svg>
