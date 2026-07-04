<script lang="ts">
  import ConfirmButton from '@/components/chrome/ConfirmButton.svelte';
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

  function onConfirm() {
    // Failure surfaces via the toast channel; success is silent.
    saveOutputConfigBaseline(s);
  }
</script>

{#if visible}
  <ConfirmButton
    label="SAVE"
    confirmLabel="CONFIRM"
    tone="warn"
    {onConfirm}
    disabled={!connected}
    title="Persist the current IO config (pins, output types, I2S clock, S/PDIF RX pin) as the device boot config"
    disabledReason="Connect a device to enable this action."
  />
{/if}
