<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import KV from '@/components/chrome/KV.svelte';
  import ConfirmButton from '@/components/chrome/ConfirmButton.svelte';
  import { connection } from '@/state';
  import { factoryResetDevice, enterBootloader, MIN_CS_CAPS_VERSION, MAX_KNOWN_CS_CAPS_VERSION } from '@/runtime';
  import { SUPPORT_WINDOW } from '@/protocol/capabilities';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const snap = $derived(s.mirror.current);
  const connected = $derived(connection.connected);

  // Sub-protocol versions the wire format can't convey: shown so users can
  // tell at a glance why a feature panel is gated on their firmware.
  const cs = $derived(s.controlSurfaces);
  const csTooOld = $derived(cs.deviceCapsVersion != null && cs.caps == null && !cs.busy);
  const csProto = $derived(cs.deviceCapsVersion == null ? '—' : `v${cs.deviceCapsVersion}`);
  const ctrlProto = $derived(
    s.ctrlIfaces.status ? `v${s.ctrlIfaces.status.protoVersion}` : '—');

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
    <KV label="FIRMWARE" value={s.info.capabilities.fwLabel}
        title={`Firmware releases this console supports: ${SUPPORT_WINDOW.fw}.`} />
    <KV label="PLATFORM" value={snap?.platform.name ?? '—'} />
    <KV label="FORMAT"   value={s.info.capabilities.wireLabel}
        title={`Wire formats this console supports: ${SUPPORT_WINDOW.wire}. Newer formats load with known sections only.`} />
    <KV label="OUTPUTS"  value={`${snap?.platform.outputCount ?? 0} / ${snap?.platform.totalChannelCount ?? 0}`} />
    <KV label="CS PROTO"   value={csProto} tone={csTooOld ? 'warn' : cs.deviceCapsVersion == null ? 'off' : undefined}
        title={`Control Surfaces protocol versions this console supports: v${MIN_CS_CAPS_VERSION}–v${MAX_KNOWN_CS_CAPS_VERSION}.`} />
    <KV label="CTRL PROTO" value={ctrlProto} tone={s.ctrlIfaces.status ? undefined : 'off'}
        title="External control interface (UART/I2C) protocol this console knows: v1." />
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
