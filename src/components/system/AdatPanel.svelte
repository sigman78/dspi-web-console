<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import KV from '@/components/chrome/KV.svelte';
  import PinPicker from './PinPicker.svelte';
  import { connection } from '@/state';
  import { setAdatEnable, setAdatPin } from '@/runtime';
  import { pickerCells, assignablePins, isAssignablePin, pinsInUse, liveCsPinConfigs } from '@/domain';
  import { Wire } from '@/protocol';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();

  const connected = $derived(connection.connected);
  const snap = $derived(s.mirror.current);
  const cfg = $derived(snap?.adat);
  const status = $derived(s.telemetry.adatStatus);
  const features = $derived(s.device.capabilities.features);
  const ctrlPins = $derived({ uart: s.ctrlIfaces.uart, i2c: s.ctrlIfaces.i2c, cs: liveCsPinConfigs(s.controlSurfaces.bindings, s.controlSurfaces.status) });
  const editable = $derived(connected && cfg != null && cfg.enabled);

  // pin 0 (never explicitly configured) means "platform default" (GPIO 12).
  const effPin = $derived(cfg ? (cfg.pin || 12) : 0);

  function fmtRate(ok: boolean): string { return ok ? '44.1/48 OK' : 'PARKED — RATE > 48 KHZ'; }

  // The firmware refuses to enable ADAT on a pin another peripheral already
  // holds, so the enable write must ship a usable pin up front: the stored
  // one when free, else the first free assignable pin (mirrors
  // DacHwMutePanel.onToggleEnabled). Failure of either step surfaces via the
  // writeChecked toasts already wired into setAdatPin/setAdatEnable.
  async function onToggleEnabled() {
    if (!cfg || !snap) return;
    if (cfg.enabled) {
      setAdatEnable(s, false);
      return;
    }
    const wantPin = cfg.pin || 12;
    const inUse = pinsInUse(snap, ctrlPins);
    const free = (p: number) => isAssignablePin(snap.platform.type, p, snap.platform.channelModel) && !inUse.has(p);
    // When the ADAT input borrowed our pin (loopback), relocating would break
    // the loopback silently -- ship the enable as-is and let the device's
    // PIN_IN_USE refusal explain (the input must be disabled first).
    if (!free(wantPin) && inUse.get(wantPin) !== 'ADAT IN') {
      const pin = assignablePins(snap.platform.type, snap.platform.channelModel).find(free) ?? wantPin;
      const ok = await setAdatPin(s, pin);
      if (!ok) return;
    }
    setAdatEnable(s, true);
  }
</script>

<Panel code="SY.14" title="ADAT OUTPUT">
  {#snippet right()}
    {#if features.pinResetDefault}
      <button
        class="chip"
        disabled={!editable}
        title="Reset to the platform default pin"
        onclick={() => setAdatPin(s, Wire.Const.PIN_RESET_TO_DEFAULT)}
      >DEFAULT</button>
    {/if}
    <ToggleSwitch
      size="sm"
      checked={cfg?.enabled ?? false}
      disabled={!connected || !cfg}
      ariaLabel={cfg?.enabled ? 'Disable ADAT output' : 'Enable ADAT output'}
      onChange={() => onToggleEnabled()}
    />
  {/snippet}

  {#if cfg && snap}
    <div class="rows">
      <div class="row">
        <span class="microlbl">GPIO PIN</span>
        <PinPicker
          value={effPin}
          cells={pickerCells(snap.platform.type, snap, ctrlPins, effPin)}
          ariaLabel="ADAT output GPIO pin"
          disabled={!editable}
          onChange={(p) => setAdatPin(s, p)}
        />
      </div>
    </div>

    {#if cfg.enabled}
      <div class="subhdr">ADAT STATUS</div>
      {#if status}
        <div class="kvgrid">
          <KV label="ACTIVE" value={status.active ? 'YES' : 'NO'} tone={status.active ? 'ok' : 'off'} />
          <KV label="RATE" value={fmtRate(status.rateOk)} tone={status.rateOk ? undefined : 'warn'} />
          <KV label="RESYNC" value={String(status.resyncCount)} />
          <KV label="SLIP" value={String(status.slipCount)} tone={status.slipCount > 0 ? 'warn' : undefined} />
        </div>
      {:else}
        <p class="hint idle">Waiting for ADAT status…</p>
      {/if}
    {/if}
  {/if}

  <p class="hint">Streams outputs 1–8 as one optical lightpipe frame. Auto-suspends above 48 kHz and resumes automatically.</p>
</Panel>

<style>
  .rows { padding: 14px; display: flex; flex-direction: column; gap: 8px; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .hint { padding: 0 14px 12px; }
  .idle { padding: 6px 14px 10px; }
</style>
