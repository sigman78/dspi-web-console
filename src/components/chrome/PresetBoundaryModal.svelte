<script lang="ts">
  import { boundary, resolveBoundary } from '../../state';

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
        <button class="btn" onclick={() => resolveBoundary('cancel')}>Cancel</button>
        <button class="btn warn" onclick={() => resolveBoundary('discard')}>Switch anyway</button>
        <button class="btn primary" onclick={() => resolveBoundary('save')}>{boundary.pending.saveLabel}</button>
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
  .btn {
    padding: 5px 12px; border-radius: 4px;
    font-family: inherit; font-size: 10px; letter-spacing: 1px; font-weight: 600;
    background: var(--panel-solid); color: var(--text-dim);
    border: 1px solid var(--border); cursor: pointer;
  }
  .btn:hover { color: var(--text); border-color: var(--border-hi); }
  .btn.warn   { color: var(--warn); border-color: color-mix(in oklab, var(--warn) 40%, var(--border)); }
  .btn.primary {
    color: var(--accent);
    border-color: color-mix(in oklab, var(--accent) 50%, var(--border));
    background: color-mix(in oklab, var(--accent) 12%, transparent);
  }
</style>
