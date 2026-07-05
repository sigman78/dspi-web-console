<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import SegmentedSelect from '@/components/chrome/SegmentedSelect.svelte';
  import PinSelect from './PinSelect.svelte';
  import { connection } from '@/state';
  import { stageI2sBckPin, stageMckEnabled, stageMckPin, stageMckMultiplier } from '@/runtime';
  import { validBckPins, availablePinsFor, OutputSlotType, liveCsPinConfigs } from '@/domain';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();

  const snap = $derived(s.mirror.current);
  const overlaySnap = $derived(snap ? s.staging.overlaySnapshot(snap) : null);
  const connected = $derived(connection.connected);
  const anyI2s = $derived(snap?.i2s?.outputSlotTypes.some((t) => t === OutputSlotType.I2s) ?? false);
  const rate = $derived(s.telemetry.info?.sampleRateHz ?? 0);
  const allow256 = $derived(rate < 96000);
  const ctrlPins = $derived({ uart: s.ctrlIfaces.uart, i2c: s.ctrlIfaces.i2c, cs: liveCsPinConfigs(s.controlSurfaces.bindings, s.controlSurfaces.status) });

  const effBckPin = $derived(snap ? s.staging.valueOf('bckPin', snap.i2s.bckPin) : 0);
  const effMckEnabled = $derived(snap ? s.staging.valueOf('mckEnabled', snap.i2s.mckEnabled) : false);
  const effMckPin = $derived(snap ? s.staging.valueOf('mckPin', snap.i2s.mckPin) : 0);
  const effMckMultiplier = $derived(snap ? s.staging.valueOf('mckMultiplier', snap.i2s.mckMultiplierEncoded) : 0);

  const bckCandidates = $derived(
    overlaySnap ? validBckPins(overlaySnap.platform.type, overlaySnap, ctrlPins).map((pin) => ({ pin, usedBy: null })) : [],
  );
  const multOpts = $derived([
    { value: 0, label: '128×' },
    { value: 1, label: '256×', disabled: !allow256 },
  ]);

</script>

<Panel code="SY.08" title="I2S CLOCK">
  {#if snap?.i2s && overlaySnap}
    <div class="rows">
      <div class="row">
        <span class="microlbl">BCK</span>
        <span class="stage-wrap" class:staged={s.staging.has('bckPin')} title={s.staging.has('bckPin') ? `device: GP${snap.i2s.bckPin}` : undefined}>
          <PinSelect
            value={effBckPin}
            candidates={bckCandidates}
            ariaLabel="I2S BCK pin"
            disabled={!connected || anyI2s}
            onChange={(p) => stageI2sBckPin(s, p)}
          />
        </span>
        <span class="hint">LRCLK GP{effBckPin + 1}</span>
      </div>
      {#if anyI2s}
        <div class="hint">Set all slots to SPDIF to change BCK.</div>
      {/if}

      <div class="row">
        <span class="microlbl">MCK</span>
        <span class="stage-wrap" class:staged={s.staging.has('mckEnabled')}>
          <ToggleSwitch
            size="sm"
            checked={effMckEnabled}
            ariaLabel={effMckEnabled ? 'Disable MCK' : 'Enable MCK'}
            disabled={!connected}
            onChange={(v) => stageMckEnabled(s, v)}
          />
        </span>
        <span class="stage-wrap" class:staged={s.staging.has('mckPin')} title={s.staging.has('mckPin') ? `device: GP${snap.i2s.mckPin}` : undefined}>
          <PinSelect
            value={effMckPin}
            candidates={availablePinsFor(snap.platform.type, overlaySnap, effMckPin, ctrlPins)}
            ariaLabel="MCK pin"
            disabled={!connected || effMckEnabled}
            onChange={(p) => stageMckPin(s, p)}
          />
        </span>
      </div>
      {#if effMckEnabled}
        <div class="hint">Turn MCK off to change its pin.</div>
      {/if}

      <div class="row">
        <span class="microlbl">MULT</span>
        <span class="stage-wrap" class:staged={s.staging.has('mckMultiplier')}>
          <SegmentedSelect
            size="sm"
            value={effMckMultiplier}
            options={multOpts}
            ariaLabel="MCK multiplier"
            disabled={!connected}
            onChange={(v) => stageMckMultiplier(s, v)}
          />
        </span>
        {#if !allow256}<span class="hint">256× unavailable ≥96 kHz</span>{/if}
      </div>
    </div>
  {/if}
</Panel>

<style>
  .rows { padding: 14px; display: grid; grid-template-columns: 3rem max-content max-content; gap: 8px 10px; align-items: center; justify-content: space-between; }
  .row { display: grid; grid-template-columns: subgrid; grid-column: 1 / -1; align-items: center; }
  .rows > .hint { grid-column: 1 / -1; }
</style>
