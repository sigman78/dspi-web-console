<script lang="ts">
  import { confirmState, resolveConfirm } from '@/state';
  import ConfirmModal from './ConfirmModal.svelte';
</script>

{#if confirmState.pending}
  {@const p = confirmState.pending}
  <ConfirmModal
    title={p.title}
    body={p.body}
    confirmLabel={p.confirmLabel}
    tone={p.tone}
    onConfirm={() => resolveConfirm(true)}
    onCancel={() => resolveConfirm(false)}
  />
{/if}
