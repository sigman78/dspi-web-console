<script lang="ts">
  import { boundary, resolveBoundary } from '@/state';

  function onKey(e: KeyboardEvent) {
    if (boundary.pending == null) return;
    if (e.key === 'Escape') { e.preventDefault(); resolveBoundary('cancel'); }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if boundary.pending}
  <div class="scrim" role="dialog" aria-modal="true" aria-labelledby="bdry-title">
    <div class="panel">
      <h2 id="bdry-title">{boundary.pending.title}</h2>
      <p>{boundary.pending.message}</p>
      <div class="actions">
        <button class="chip md" onclick={() => resolveBoundary('cancel')}>Cancel</button>
        <button class="chip md warn" onclick={() => resolveBoundary('discard')}>{boundary.pending.discardLabel ?? 'Switch anyway'}</button>
        {#if boundary.pending.saveLabel}
          <button class="chip md accent" onclick={() => resolveBoundary('save')}>{boundary.pending.saveLabel}</button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed; inset: 0;
    background: color-mix(in oklab, var(--bg) 70%, transparent);
    backdrop-filter: blur(6px);
    display: grid; place-items: center;
    z-index: 1000;
    font-family: var(--font-mono);
  }
  .panel {
    background: var(--panel-solid);
    border: 1px solid var(--border-hi);
    border-radius: 6px;
    padding: 18px 20px;
    min-width: 360px;
    max-width: 480px;
    color: var(--text);
  }
  h2 { font-size: 12px; letter-spacing: 1.5px; margin: 0 0 8px; color: var(--text); }
  p  { font-size: 11px; color: var(--text-dim); margin: 0 0 16px; line-height: 1.4; }
  .actions { display: flex; gap: 8px; justify-content: flex-end; }
</style>
