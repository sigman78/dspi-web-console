<script lang="ts">
  import ConfirmButton from '@/components/chrome/ConfirmButton.svelte';
  import { connection, activeSession } from '@/state';
  import { saveMasterVolumeBaseline } from '@/runtime';
  import { MasterVolumeMode, DIFF_TOLERANCE } from '@/domain';

  const s = $derived(activeSession());
  const connected = $derived(connection.connected);
  const mode = $derived(s?.presets.directory?.masterVolumeMode ?? MasterVolumeMode.Independent);
  const visible = $derived(mode === MasterVolumeMode.Independent);

  // Enabled unless the live volume provably equals the saved boot baseline.
  // Unknown saved value (not yet fetched) or any other edge -> stays enabled.
  const saved = $derived(s?.presets.savedMasterVolumeDb);
  const live = $derived(s?.mirror.current?.masterVolumeDb ?? null);
  const clean = $derived(saved != null && live != null && Math.abs(live - saved) <= DIFF_TOLERANCE.db);
  const disabled = $derived(!connected || clean);
  const disabledReason = $derived(
    !connected ? 'Connect a device to enable this action.' : 'Volume already matches the saved boot baseline.',
  );

  function onConfirm() {
    // Failure surfaces via the toast channel; success is silent.
    if (s) saveMasterVolumeBaseline(s);
  }
</script>

{#if visible}
  <ConfirmButton
    label="SAVE"
    confirmLabel="CONFIRM"
    extraClass="mv-save"
    {onConfirm}
    {disabled}
    title="Save the current master volume as the boot-baseline volume"
    {disabledReason}
  />
{/if}

<style>
  /* Narrower than the shared .chip padding and a step dimmer at rest; this
     predates .chip.warn and doesn't match its recipe -- kept as-is rather
     than unified, to avoid an unrelated visual change here. :global()
     because ConfirmButton renders the actual <button>. */
  :global(.mv-save) {
    padding: 3px 8px;
    color: var(--text-faint);
  }
  :global(.mv-save:hover:not([aria-disabled="true"])) { color: var(--text-dim); }
  :global(.mv-save.armed) {
    color: var(--warn);
    border-color: color-mix(in oklab, var(--warn) 50%, var(--border));
    background: color-mix(in oklab, var(--warn) 14%, transparent);
  }
</style>
