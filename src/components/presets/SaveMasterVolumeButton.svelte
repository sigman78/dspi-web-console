<script lang="ts">
  import { connection, activeSession } from '@/state';
  import { saveMasterVolumeBaseline } from '@/runtime';
  import { MasterVolumeMode, DIFF_TOLERANCE } from '@/domain';

  const uid = $props.id();
  const reasonId = uid + '-reason';
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
  <button
    type="button"
    class="chip mv-save"
    onclick={() => { if (!disabled) onConfirm(); }}
    aria-disabled={disabled}
    aria-describedby={disabled ? reasonId : undefined}
    title={disabled ? disabledReason : 'Save the current master volume as the boot-baseline volume'}
  >SAVE</button>
  {#if disabled}<span id={reasonId} class="sr-only">{disabledReason}</span>{/if}
{/if}

<style>
  .mv-save { padding: 0 8px; color: var(--text-faint); }
  .mv-save:hover:not([aria-disabled="true"]) { color: var(--text-dim); }
  .mv-save[aria-disabled="true"] { opacity: var(--dim-disabled); cursor: default; }
</style>
