<script lang="ts">
  const { icon, size = 14 }: { icon: 'share' | 'link' | 'copy' | 'check' | 'close' | 'rotate'; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if icon === 'share'}
    <circle cx="12" cy="3.5" r="1.8" />
    <circle cx="4" cy="8" r="1.8" />
    <circle cx="12" cy="12.5" r="1.8" />
    <path d="M5.6 7.1l4.8-2.7M5.6 8.9l4.8 2.7" />
  {:else if icon === 'link'}
    <path d="M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2.5-2.5a2.5 2.5 0 0 0-3.5-3.5l-.7.7" />
    <path d="M9.5 6.5a2.5 2.5 0 0 0-3.5 0L3.5 9a2.5 2.5 0 0 0 3.5 3.5l.7-.7" />
  {:else if icon === 'copy'}
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.2" />
    <path d="M10.5 5.5V3.7a1.2 1.2 0 0 0-1.2-1.2H3.7a1.2 1.2 0 0 0-1.2 1.2v5.6a1.2 1.2 0 0 0 1.2 1.2h1.8" />
  {:else if icon === 'check'}
    <path d="M3 8.5l3.2 3.2L13 4.8" />
  {:else if icon === 'close'}
    <path d="M4 4l8 8M12 4l-8 8" />
  {:else}
    <path d="M3 8a5 5 0 1 0 1.6-3.7" />
    <path d="M3 2.5v3h3" />
  {/if}
</svg>
