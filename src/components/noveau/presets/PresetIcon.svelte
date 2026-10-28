<script lang="ts">
  const { icon }: { icon: 'save' | 'revert' | 'bypass' | 'edit' } = $props();
</script>

<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if icon === 'save'}
    <rect x="2" y="2" width="12" height="12" rx="1.5" />
    <rect x="5" y="2" width="5" height="3.5" />
    <rect x="4.5" y="9" width="7" height="5" />
  {:else if icon === 'bypass'}
    <path d="M2 8 C 3.3 8 3.7 5 5 5 S 6.7 8 8 8 S 9.7 11 11 11 S 12.7 8 14 8" />
  {:else if icon === 'edit'}
    <line x1="2" y1="4.5" x2="14" y2="4.5" />
    <line x1="2" y1="11.5" x2="14" y2="11.5" />
    <circle cx="10" cy="4.5" r="1.8" fill="currentColor" />
    <circle cx="6" cy="11.5" r="1.8" fill="currentColor" />
  {:else}
    <path d="M3 8a5 5 0 1 0 1.6-3.7" />
    <path d="M3 2.5v3h3" />
  {/if}
</svg>
