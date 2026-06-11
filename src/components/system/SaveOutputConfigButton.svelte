<script lang="ts">
  import { connection } from '@/state';
  import { saveOutputConfigBaseline } from '@/runtime';
  import { OutputConfigMode } from '@/domain';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const connected = $derived(connection.connected);
  const mode = $derived(s.presets.directory?.outputConfigMode ?? OutputConfigMode.WithPreset);
  // Shown only when the IO block is device-global and the firmware has the
  // 0x52 verb (1.1.4+). WithPreset fallback while the directory is unknown
  // keeps the button hidden rather than offering a dormant save. No
  // saved-readback opcode exists, so no clean-detect -- enabled while visible.
  const visible = $derived(
    s.device.capabilities.features.outputConfigSave && mode === OutputConfigMode.Independent,
  );

  let confirming = $state(false);

  function onClick() {
    if (!confirming) { confirming = true; return; }
    confirming = false;
    // Failure surfaces via the toast channel; success is silent.
    saveOutputConfigBaseline(s);
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
    title="Persist the current IO config (pins, output types, I2S clock, S/PDIF RX pin) as the device boot config"
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
