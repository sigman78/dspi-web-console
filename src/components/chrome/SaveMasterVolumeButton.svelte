<script lang="ts">
  import { presets, session } from '@/state';
  import { saveMasterVolumeBaseline } from '@/runtime';
  import { MasterVolumeMode } from '@/domain';

  const connected = $derived(session.status === 'connected');
  const mode = $derived(presets.directory?.masterVolumeMode ?? MasterVolumeMode.Independent);
  const visible = $derived(mode === MasterVolumeMode.Independent);

  let confirming = $state(false);
  let savedTick  = $state(false);

  async function onClick() {
    if (savedTick) return;
    if (!confirming) { confirming = true; return; }
    confirming = false;
    const r = await saveMasterVolumeBaseline();
    if (r.ok) {
      savedTick = true;
      setTimeout(() => { savedTick = false; }, 1200);
    }
  }

  function onBlur() { confirming = false; }
</script>

{#if visible}
  <button
    class="save"
    class:confirming
    class:saved={savedTick}
    onclick={onClick}
    onblur={onBlur}
    disabled={!connected}
    title="Save the current master volume as the boot-baseline volume"
  >
    {#if savedTick}OK{:else if confirming}CONFIRM{:else}SAVE{/if}
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
  .save.saved {
    color: var(--ok);
    border-color: color-mix(in oklab, var(--ok) 50%, var(--border));
    background: color-mix(in oklab, var(--ok) 14%, transparent);
  }
</style>
