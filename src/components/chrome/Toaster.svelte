<script lang="ts">
  import { notices, dismissNotice } from '@/state';
</script>

{#if notices.list.length > 0}
  <div class="toaster" role="region" aria-label="Notifications">
    {#each notices.list as n (n.id)}
      <div class="toast {n.kind}" role="alert">
        <span class="msg">{n.message}</span>
        <button class="x-btn dismiss" aria-label="Dismiss notification" onclick={() => dismissNotice(n.id)}>✕</button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .toaster {
    position: fixed;
    right: 12px;
    bottom: 12px;
    z-index: var(--z-toast);
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
    border: 1px solid var(--border-hi);
    border-left-width: 3px;
    border-radius: var(--radius-s);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text);
    box-shadow: var(--shadow-pop);
  }
  .toast.error { border-left-color: var(--err); }
  .toast.warn  { border-left-color: var(--warn); }
  .toast.info  { border-left-color: var(--accent); }
  .dismiss { flex: none; font-size: 11px; margin-top: 1px; }
  .msg { flex: 1; line-height: 1.4; word-break: break-word; }
</style>
