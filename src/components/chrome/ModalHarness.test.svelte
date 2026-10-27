<script lang="ts">
  import Modal from './Modal.svelte';
  const { onCancel, initialFocus }: { onCancel: () => void; initialFocus?: string } = $props();
</script>

<Modal ariaLabel="Test" {onCancel} {initialFocus}>
  <div>
    <button data-safe>Cancel</button>
    <button>Apply</button>
    <input type="text" aria-label="Field" />
  </div>
</Modal>
