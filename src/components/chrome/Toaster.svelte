<script lang="ts">
  import { notices, dismissNotice } from '@/state';
</script>

{#if notices.list.length > 0}
  <div class="toaster" role="region" aria-label="Notifications">
    {#each notices.list as n (n.id)}
      <div class="toast {n.kind}" role="alert">
        <span class="msg">{n.message}</span>
        <button class="dismiss" aria-label="Dismiss notification" onclick={() => dismissNotice(n.id)}>✕</button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .toaster {
    position: fixed;
    right: 12px;
    bottom: 12px;
    z-index: 100;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-width: min(360px, calc(100vw - 24px));
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 10px;
    background: var(--panel-solid);
    border: 1px solid color-mix(in oklab, var(--text) 12%, transparent);
    border-left-width: 3px;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text);
    box-shadow: 0 4px 14px oklch(0% 0 0 / 0.4);
  }
  .toast.error { border-left-color: var(--err); }
  .toast.warn  { border-left-color: var(--warn); }
  .toast.info  { border-left-color: var(--accent); }
  .msg { flex: 1; line-height: 1.4; word-break: break-word; }
  .dismiss {
    flex: none;
    background: none;
    border: none;
    color: var(--text-faint);
    cursor: pointer;
    font-size: 11px;
    line-height: 1;
    padding: 0;
  }
  .dismiss:hover { color: var(--text); }
</style>
