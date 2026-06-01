<script lang="ts">
  import { presets, session } from '@/state';
  import { saveMasterVolumeBaseline } from '@/runtime';
  import { MasterVolumeMode } from '@/domain';

  const connected = $derived(session.status === 'connected');
  const mode = $derived(presets.directory?.masterVolumeMode ?? MasterVolumeMode.Independent);
  const visible = $derived(mode === MasterVolumeMode.Independent);

  let confirming = $state(false);

  function onClick() {
    if (!confirming) { confirming = true; return; }
    confirming = false;
    // Success and failure both surface via the toast channel.
    saveMasterVolumeBaseline();
  }

  function onBlur() { confirming = false; }
</script>

{#if visible}
  <button
    class="save"
    class:confirming
    onclick={onClick}
    onblur={onBlur}
    disabled={!connected}
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
