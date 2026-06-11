<script lang="ts">
  import { connection } from '@/state';
  import { saveOutputConfigBaseline } from '@/runtime';
  import { OutputConfigMode } from '@/domain';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const connected = $derived(connection.connected);
  const mode = $derived(s.presets.directory?.outputConfigMode ?? OutputConfigMode.WithPreset);
  // Shown only when the IO block is device-global. WithPreset fallback while
  // the directory is unknown keeps the button hidden rather than offering a
  // dormant save. No saved-readback opcode exists, so no clean-detect --
  // enabled while visible.
  const visible = $derived(mode === OutputConfigMode.Independent);

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
    class="chip"
    class:warn={confirming}
    onclick={onClick}
    onblur={onBlur}
    disabled={!connected}
    title="Persist the current IO config (pins, output types, I2S clock, S/PDIF RX pin) as the device boot config"
  >
    {#if confirming}CONFIRM{:else}SAVE{/if}
  </button>
{/if}
