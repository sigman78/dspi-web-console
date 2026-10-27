<script lang="ts">
  import type { Snippet } from 'svelte';
  import Modal from './Modal.svelte';

  const {
    title,
    body,
    confirmLabel,
    tone,
    onConfirm,
    onCancel,
  }: {
    title: string;
    body: string | Snippet;
    confirmLabel: string;
    tone: 'danger' | 'warn';
    onConfirm: () => void;
    onCancel: () => void;
  } = $props();

  const uid = $props.id();
</script>

<Modal labelledBy="{uid}-title" {onCancel}>
  <div class="panel">
    <h2 id="{uid}-title">{title}</h2>
    <p>
      {#if typeof body === 'string'}{body}{:else}{@render body()}{/if}
    </p>
    <div class="actions">
      <button type="button" class="chip md" data-safe onclick={onCancel}>CANCEL</button>
      <button type="button" class="chip md {tone}" onclick={onConfirm}>{confirmLabel}</button>
    </div>
  </div>
</Modal>

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
