<script lang="ts">
  import { noveauUi } from '@/components/noveau/noveauUi.svelte';
</script>

<button
  type="button"
  class="chip md icon tog"
  class:on={noveauUi.pinMapOpen}
  aria-pressed={noveauUi.pinMapOpen}
  title="Pin map"
  aria-label="Pin map"
  onclick={() => { noveauUi.pinMapOpen = !noveauUi.pinMapOpen; }}
>
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="4.5" y="4.5" width="7" height="7" rx="1" /><path d="M6.5 1.5v3M9.5 1.5v3M6.5 11.5v3M9.5 11.5v3M1.5 6.5h3M1.5 9.5h3M11.5 6.5h3M11.5 9.5h3" /></svg>
</button>

<style>
  .tog { display: inline-grid; place-items: center; }
  .tog svg { fill: none; stroke: currentColor; stroke-width: 1.3; stroke-linecap: round; stroke-linejoin: round; }
</style>
