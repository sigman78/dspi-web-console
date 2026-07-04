<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import KV from '@/components/chrome/KV.svelte';
  import ConfirmButton from '@/components/chrome/ConfirmButton.svelte';
  import { connection } from '@/state';
  import { factoryResetDevice, enterBootloader } from '@/runtime';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const snap = $derived(s.mirror.current);
  const connected = $derived(connection.connected);

  function onFactoryReset() {
    void factoryResetDevice();
  }

  function onEnterBootloader() {
    void enterBootloader(s);
  }
</script>

<Panel code="SY.01" title="DEVICE">
  <div class="kvgrid">
    <KV label="STATUS"   value={connection.label} tone={connection.connected ? 'ok' : 'off'} />
    <KV label="SERIAL"   value={s.info.serial} />
    <KV label="FIRMWARE" value={s.info.capabilities.fwLabel} />
    <KV label="PLATFORM" value={snap?.platform.name ?? '—'} />
    <KV label="FORMAT"   value={s.info.capabilities.wireLabel} />
    <KV label="OUTPUTS"  value={`${snap?.platform.outputCount ?? 0} / ${snap?.platform.totalChannelCount ?? 0}`} />
  </div>
  <div class="divider"></div>
  <div class="actions">
    <ConfirmButton
      label="FACTORY RESET"
      confirmLabel="CONFIRM RESET"
      tone="danger"
      toneAlways
      extraClass="md"
      onConfirm={onFactoryReset}
      disabled={!connected}
      title="Wipes all presets and resets live audio to firmware defaults."
      disabledReason="Connect a device to enable this action."
    />
    <ConfirmButton
      label="UPDATE FIRMWARE"
      confirmLabel="CONFIRM REBOOT"
      tone="warn"
      toneAlways
      extraClass="md"
      onConfirm={onEnterBootloader}
      disabled={!connected}
      title="Reboots into UF2 bootloader — device disconnects immediately."
      disabledReason="Connect a device to enable this action."
    />
  </div>
</Panel>

<style>
  .divider { height: 1px; background: var(--wash); margin: 0 14px; }
  .actions {
    padding: 12px 14px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
</style>
