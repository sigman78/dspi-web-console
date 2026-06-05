<script lang="ts">
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

  let confirming = $state(false);

  function onClick() {
    if (!confirming) { confirming = true; return; }
    confirming = false;
    // Failure surfaces via the toast channel; success is silent.
    if (s) saveMasterVolumeBaseline(s);
  }

  function onBlur() { confirming = false; }
</script>

{#if visible}
  <button
    class="save"
    class:confirming
    onclick={onClick}
    onblur={onBlur}
    disabled={!connected || clean}
    title="Save the current master volume as the boot-baseline volume"
  >
    {#if confirming}CONFIRM{:else}SAVE{/if}
  </button>
{/if}

<style>
  .save {
    padding: 3px 8px;
    border-radius: 3px;
    font-family: var(--font-mono); font-size: 9px;
    letter-spacing: 1px; font-weight: 700;
    background: color-mix(in oklab, var(--text) 4%, transparent);
    border: 1px solid var(--border);
    color: var(--text-faint);
    cursor: pointer;
  }
  .save:hover:not(:disabled) { color: var(--text-dim); border-color: var(--border-hi); }
  .save:disabled { opacity: 0.4; cursor: default; }
  .save.confirming {
    color: var(--warn);
    border-color: color-mix(in oklab, var(--warn) 50%, var(--border));
    background: color-mix(in oklab, var(--warn) 14%, transparent);
  }
</style>
