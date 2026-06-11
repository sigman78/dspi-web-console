<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import KV from '@/components/chrome/KV.svelte';
  import { connection, activeSession } from '@/state';
  import { factoryResetDevice, enterBootloader } from '@/runtime';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const snap = $derived(s.mirror.current);
  const connected = $derived(connection.connected);

  function onFactoryReset() {
    if (!confirm('Factory reset wipes ALL presets and resets live audio to defaults. Continue?')) return;
    void factoryResetDevice();
  }

  function onEnterBootloader() {
    if (!confirm('Enter UF2 bootloader for firmware update? The device will disconnect immediately.')) return;
    const sess = activeSession();
    if (!sess) return;
    void enterBootloader(sess);
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
    <button
      class="danger"
      onclick={onFactoryReset}
      disabled={!connected}
      title="Wipes all presets and resets live audio to firmware defaults."
    >FACTORY RESET</button>
    <button
      class="danger fw"
      onclick={onEnterBootloader}
      disabled={!connected}
      title="Reboots into UF2 bootloader — device disconnects immediately."
    >UPDATE FIRMWARE</button>
  </div>
</Panel>

<style>
  .kvgrid { padding: 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .divider { height: 1px; background: color-mix(in oklab, var(--text) 4%, transparent); margin: 0 14px; }
  .actions {
    padding: 12px 14px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .danger {
    padding: 6px 14px;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 1.5px;
    font-weight: 700;
    background: color-mix(in oklab, var(--err) 12%, transparent);
    border: 1px solid color-mix(in oklab, var(--err) 50%, var(--border));
    color: var(--err);
    cursor: pointer;
  }
  .danger:disabled { opacity: 0.4; cursor: default; }
  .danger.fw {
    background: color-mix(in oklab, var(--warn) 10%, transparent);
    border-color: color-mix(in oklab, var(--warn) 50%, var(--border));
    color: var(--warn);
  }
</style>
