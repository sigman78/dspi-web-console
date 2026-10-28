<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import KV from '@/components/chrome/KV.svelte';
  import ConfirmButton from '@/components/chrome/ConfirmButton.svelte';
  import { askConfirm } from '@/state';
  import { factoryResetDevice, enterBootloader, MIN_CS_CAPS_VERSION, MAX_KNOWN_CS_CAPS_VERSION } from '@/runtime';
  import { SUPPORT_WINDOW } from '@/protocol/capabilities';
  import { getSession } from '@/components/sessionContext';
  import { FIRMWARE_RELEASES_URL } from '@/buildInfo';

  const s = getSession();
  // Sub-protocol versions the wire format can't convey: shown so users can
  // tell at a glance why a feature panel is gated on their firmware.
  const cs = $derived(s.controlSurfaces);
  const csTooOld = $derived(cs.deviceCapsVersion != null && cs.caps == null && !cs.busy);
  const csProto = $derived(cs.deviceCapsVersion == null ? '—' : `v${cs.deviceCapsVersion}`);
  const ctrlProto = $derived(
    s.ctrlIfaces.status ? `v${s.ctrlIfaces.status.protoVersion}` : '—');
  const build = $derived(s.info.build);

  async function onFactoryReset() {
    const ok = await askConfirm({
      title: 'Factory reset',
      body: 'Wipes all presets and resets live audio to firmware defaults. This cannot be undone.',
      confirmLabel: 'RESET DEVICE',
      tone: 'danger',
    });
    if (ok) await factoryResetDevice();
  }

  function onEnterBootloader() {
    void enterBootloader(s);
  }
</script>

<Panel title="FIRMWARE">
  <div class="kvrows">
    <KV inline label="FIRMWARE" value={s.info.capabilities.fwLabel}
        title={`Firmware releases this console supports: ${SUPPORT_WINDOW.fw}.`} />
    <KV inline label="BUILD" value={build ? `${build.describe} · ${build.date}` : '—'}
        tone={build ? undefined : 'off'}
        title="Firmware git build stamp (fw 1.1.6+). Provenance only — compatibility is decided by the version above." />
    <KV inline label="FORMAT"   value={s.info.capabilities.wireLabel}
        title={`Wire formats this console supports: ${SUPPORT_WINDOW.wire}. Newer formats load with known sections only.`} />
    <KV inline label="CS PROTO"   value={csProto} tone={csTooOld ? 'warn' : cs.deviceCapsVersion == null ? 'off' : undefined}
        title={`Control Surfaces protocol versions this console supports: v${MIN_CS_CAPS_VERSION}–v${MAX_KNOWN_CS_CAPS_VERSION}. Newer formats load with known fields only.`} />
    <KV inline label="CTRL PROTO" value={ctrlProto} tone={s.ctrlIfaces.status ? undefined : 'off'}
        title="External control interface (UART/I2C) protocol this console knows: v1." />
  </div>
  <div class="divider"></div>
  <div class="actions">
    <ConfirmButton
      label="UPDATE FIRMWARE"
      confirmLabel="CONFIRM REBOOT"
      tone="warn"
      toneAlways
      extraClass="md"
      onConfirm={onEnterBootloader}
      title="Reboots into UF2 bootloader — device disconnects immediately."
    />
    <a class="chip fwlink" href={FIRMWARE_RELEASES_URL} target="_blank" rel="noopener" title="Firmware releases (UF2) on GitHub">FIRMWARE RELEASES ↗</a>
    <button
      type="button"
      class="chip md danger"
      onclick={() => void onFactoryReset()}
      title="Wipes all presets and resets live audio to firmware defaults."
    >FACTORY RESET</button>
  </div>
</Panel>

<style>
  .divider { height: 1px; background: var(--wash); margin: 0 14px; }
  .actions { padding: 12px 14px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .fwlink { text-decoration: none; }
</style>
