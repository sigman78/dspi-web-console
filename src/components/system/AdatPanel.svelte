<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import KV from '@/components/chrome/KV.svelte';
  import PinPicker from './PinPicker.svelte';
  import { stageAdatEnabled, stageAdatPin, stagedCtrlPins } from '@/runtime';
  import { pickerCells } from '@/domain';
  import { Wire } from '@/protocol';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();

  const live = $derived(s.mirror.current);
  const snap = $derived(live ? s.staging.overlaySnapshot(live) : null);
  const cfg = $derived(snap?.adat);
  const status = $derived(s.telemetry.adatStatus);
  const features = $derived(s.device.capabilities.features);
  const ctrlPins = $derived(stagedCtrlPins(s));
  const editable = $derived(cfg != null && cfg.enabled);

  // pin 0 (never explicitly configured) means "platform default" (GPIO 12).
  const effPin = $derived(cfg ? (cfg.pin || 12) : 0);

  function fmtRate(ok: boolean): string { return ok ? '44.1/48 OK' : 'PARKED — RATE > 48 KHZ'; }
</script>

<Panel title="ADAT OUTPUT">
  {#snippet right()}
    {#if features.pinResetDefault}
      <button
        class="chip icon"
        disabled={!editable}
        title="Reset to defaults"
        aria-label="Reset ADAT output pin to default"
        onclick={() => stageAdatPin(s, Wire.Const.PIN_RESET_TO_DEFAULT)}
      >↺</button>
    {/if}
    <span class="stage-wrap" class:staged={s.staging.has('adatEnable')}>
      <ToggleSwitch
        checked={cfg?.enabled ?? false}
        disabled={!cfg}
        ariaLabel={cfg?.enabled ? 'Disable ADAT output' : 'Enable ADAT output'}
        onChange={(v) => stageAdatEnabled(s, v)}
      />
    </span>
  {/snippet}

  {#if cfg && snap}
    <div class="rows">
      <div class="row">
        <span class="microlbl">GPIO PIN</span>
        <span class="stage-wrap" class:staged={s.staging.has('adatPin')}>
          <PinPicker
            value={effPin}
            cells={pickerCells(snap.platform.type, snap, ctrlPins, effPin)}
            ariaLabel="ADAT output GPIO pin"
            disabled={!editable}
            onChange={(p) => stageAdatPin(s, p)}
          />
        </span>
      </div>
    </div>

    {#if live?.adat.enabled}
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
