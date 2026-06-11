<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import KV from '@/components/chrome/KV.svelte';
  import { connection } from '@/state';
  import { factoryResetDevice, enterBootloader } from '@/runtime';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const snap = $derived(s.mirror.current);
  const connected = $derived(connection.connected);

  // Two-step arm/confirm (the SaveOutputConfigButton idiom) instead of the
  // blocking native confirm(); blur disarms.
  let arming = $state<'reset' | 'fw' | null>(null);

  function onFactoryReset() {
    if (arming !== 'reset') { arming = 'reset'; return; }
    arming = null;
    void factoryResetDevice();
  }

  function onEnterBootloader() {
    if (arming !== 'fw') { arming = 'fw'; return; }
    arming = null;
    void enterBootloader(s);
  }

  function disarm() { arming = null; }
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
      class:arming={arming === 'reset'}
      onclick={onFactoryReset}
      onblur={disarm}
      disabled={!connected}
      title="Wipes all presets and resets live audio to firmware defaults."
    >{arming === 'reset' ? 'CONFIRM RESET' : 'FACTORY RESET'}</button>
    <button
      class="danger fw"
      class:arming={arming === 'fw'}
      onclick={onEnterBootloader}
      onblur={disarm}
      disabled={!connected}
      title="Reboots into UF2 bootloader — device disconnects immediately."
    >{arming === 'fw' ? 'CONFIRM REBOOT' : 'UPDATE FIRMWARE'}</button>
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
  .danger.arming {
    background: color-mix(in oklab, var(--err) 28%, transparent);
    border-color: var(--err);
  }
  .danger.fw {
    background: color-mix(in oklab, var(--warn) 10%, transparent);
    border-color: color-mix(in oklab, var(--warn) 50%, var(--border));
    color: var(--warn);
  }
  .danger.fw.arming {
    background: color-mix(in oklab, var(--warn) 26%, transparent);
    border-color: var(--warn);
  }
</style>
