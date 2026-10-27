<script lang="ts">
  const { bypassed, disabled = false, onToggle }: { bypassed: boolean; disabled?: boolean; onToggle: () => void } = $props();
</script>

<button
  type="button"
  class="byp"
  class:on={bypassed}
  title={bypassed ? 'Band bypassed — click to re-enable' : 'Bypass this band'}
  aria-label={bypassed ? 'Re-enable band' : 'Bypass band'}
  aria-pressed={bypassed}
  {disabled}
  onclick={onToggle}
>
  {#if bypassed}
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
      <line x1="2" y1="8" x2="14" y2="8" />
    </svg>
  {:else}
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2 8 C 3.3 8 3.7 5 5 5 S 6.7 8 8 8 S 9.7 11 11 11 S 12.7 8 14 8" />
    </svg>
  {/if}
</button>

<style>
  .byp {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    max-width: 28px;
    height: 20px;
    padding: 0;
    border-radius: var(--radius-s);
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-dim);
    cursor: pointer;
  }
  .byp:hover:not(:disabled) {
    color: var(--text);
    background: var(--wash);
  }
  .byp:disabled { opacity: var(--dim-disabled); cursor: default; }
  .byp.on { color: var(--warn); }
</style>
