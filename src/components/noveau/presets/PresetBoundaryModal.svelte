<script lang="ts">
  import { boundary, resolveBoundary } from '@/state';
  import Modal from '@/components/chrome/Modal.svelte';
</script>

{#if boundary.pending}
  {@const pending = boundary.pending}
  <Modal labelledBy="bdry-title" onCancel={() => resolveBoundary('cancel')}>
    <div class="panel">
      <h2 id="bdry-title">{pending.title}</h2>
      <p>{pending.message}</p>
      <div class="actions">
        <button class="chip md" data-safe onclick={() => resolveBoundary('cancel')}>Cancel</button>
        <button class="chip md warn" onclick={() => resolveBoundary('discard')}>{pending.discardLabel ?? 'Switch anyway'}</button>
        {#if pending.saveLabel}
          <button class="chip md accent" onclick={() => resolveBoundary('save')}>{pending.saveLabel}</button>
        {/if}
      </div>
    </div>
  </Modal>
{/if}

<style>
  .panel {
    background: var(--panel-solid);
    border: 1px solid var(--border-hi);
    border-radius: var(--radius-m);
    padding: 18px 20px;
    min-width: 360px;
    max-width: 480px;
    color: var(--text);
  }
  h2 { font-size: var(--fs-l); font-weight: 600; margin: 0 0 8px; color: var(--text); }
  p  { font-size: 11px; color: var(--text-dim); margin: 0 0 16px; line-height: 1.4; }
  .actions { display: flex; gap: 8px; justify-content: flex-end; }
</style>
