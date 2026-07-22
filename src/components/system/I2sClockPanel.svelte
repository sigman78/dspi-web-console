<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import SegmentedSelect from '@/components/chrome/SegmentedSelect.svelte';
  import KV from '@/components/chrome/KV.svelte';
  import PinSelect from './PinSelect.svelte';
  import { connection } from '@/state';
  import {
    stageI2sBckPin, stageMckEnabled, stageMckPin, stageMckMultiplier,
    stageI2sClockMode, stageI2sClockPinMode, stageI2sBckPinSlave,
  } from '@/runtime';
  import { validBckPins, validBckPinsSlave, availablePinsFor, OutputSlotType, liveCsPinConfigs, AudioInputSource, I2sSlaveClockState } from '@/domain';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();

  const snap = $derived(s.mirror.current);
  const overlaySnap = $derived(snap ? s.staging.overlaySnapshot(snap) : null);
  const connected = $derived(connection.connected);
  const anyI2s = $derived(snap?.i2s?.outputSlotTypes.some((t) => t === OutputSlotType.I2s) ?? false);
  const rate = $derived(s.telemetry.info?.sampleRateHz ?? 0);
  const allow256 = $derived(rate < 96000);
  const ctrlPins = $derived({ uart: s.ctrlIfaces.uart, i2c: s.ctrlIfaces.i2c, cs: liveCsPinConfigs(s.controlSurfaces.bindings, s.controlSurfaces.status) });
  const features = $derived(s.device.capabilities.features);
  const slaveStatus = $derived(s.telemetry.i2sSlaveStatus);
  const isI2sSource = $derived((snap?.inputConfig.source ?? AudioInputSource.Usb) === AudioInputSource.I2s);

  const effBckPin = $derived(snap ? s.staging.valueOf('bckPin', snap.i2s.bckPin) : 0);
  const effMckEnabled = $derived(snap ? s.staging.valueOf('mckEnabled', snap.i2s.mckEnabled) : false);
  const effMckPin = $derived(snap ? s.staging.valueOf('mckPin', snap.i2s.mckPin) : 0);
  const effMckMultiplier = $derived(snap ? s.staging.valueOf('mckMultiplier', snap.i2s.mckMultiplierEncoded) : 0);
  const effClockMode = $derived(snap ? s.staging.valueOf('i2sClockMode', snap.inputConfig.i2sClockMode) : 0);
  const effClockPinMode = $derived(snap ? s.staging.valueOf('i2sClockPinMode', snap.i2s.clockPinMode) : 0);
  const effBckPinSlave = $derived(snap ? s.staging.valueOf('bckPinSlave', snap.i2s.bckPinSlave) : 0);

  const bckCandidates = $derived(
    overlaySnap ? validBckPins(overlaySnap.platform.type, overlaySnap, ctrlPins).map((pin) => ({ pin, usedBy: null })) : [],
  );
  const slaveBckCandidates = $derived(
    overlaySnap ? validBckPinsSlave(overlaySnap.platform.type, overlaySnap, ctrlPins).map((pin) => ({ pin, usedBy: null })) : [],
  );
  const multOpts = $derived([
    { value: 0, label: '128×' },
    { value: 1, label: '256×', disabled: !allow256 },
  ]);
  const clockModeOpts = [
    { value: 0, label: 'MASTER' },
    { value: 1, label: 'SLAVE' },
  ];
  const clockPinModeOpts = [
    { value: 0, label: 'UNIFIED' },
    { value: 1, label: 'SPLIT' },
  ];

  const SLAVE_STATE_LABELS: Record<number, string> = {
    [I2sSlaveClockState.Inactive]:  'INACTIVE',
    [I2sSlaveClockState.Acquiring]: 'ACQUIRING',
    [I2sSlaveClockState.Relocking]: 'RELOCKING',
    [I2sSlaveClockState.Locked]:    'LOCKED',
  };

  function slaveStateTone(state: number): 'ok' | 'off' | undefined {
    if (state === I2sSlaveClockState.Locked) return 'ok';
    if (state === I2sSlaveClockState.Acquiring || state === I2sSlaveClockState.Relocking) return undefined;
    return 'off';
  }

  function fmtRate(hz: number): string {
    return hz > 0 ? `${(hz / 1000).toFixed(1)} kHz` : '—';
  }

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
            allowReset={features.pinResetDefault}
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
            allowReset={features.pinResetDefault}
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

      {#if features.i2sSlaveClock}
        <div class="row">
          <span class="microlbl">MODE</span>
          <span class="stage-wrap" class:staged={s.staging.has('i2sClockMode')} title={s.staging.has('i2sClockMode') ? `device: ${snap.inputConfig.i2sClockMode === 1 ? 'SLAVE' : 'MASTER'}` : undefined}>
            <SegmentedSelect
              size="sm"
              value={effClockMode}
              options={clockModeOpts}
              ariaLabel="I2S clock mode"
              disabled={!connected}
              onChange={(v) => stageI2sClockMode(s, v)}
            />
          </span>
        </div>

        <div class="row">
          <span class="microlbl">PINS</span>
          <!-- Unlike the master BCK row above, clock-role/pin-mode config isn't
               gated on anyI2s: it configures the input-side clock, independent
               of whether an output slot happens to run I2S. -->
          <span class="stage-wrap" class:staged={s.staging.has('i2sClockPinMode')} title={s.staging.has('i2sClockPinMode') ? `device: ${snap.i2s.clockPinMode === 1 ? 'SPLIT' : 'UNIFIED'}` : undefined}>
            <SegmentedSelect
              size="sm"
              value={effClockPinMode}
              options={clockPinModeOpts}
              ariaLabel="I2S clock pin mode"
              disabled={!connected}
              onChange={(v) => stageI2sClockPinMode(s, v)}
            />
          </span>
        </div>
        {#if effClockPinMode === 1}
          <div class="row">
            <span class="microlbl">SLAVE</span>
            <span class="stage-wrap" class:staged={s.staging.has('bckPinSlave')} title={s.staging.has('bckPinSlave') ? `device: GP${snap.i2s.bckPinSlave}` : undefined}>
              <PinSelect
                value={effBckPinSlave}
                candidates={slaveBckCandidates}
                ariaLabel="I2S BCK pin (slave)"
                disabled={!connected}
                allowReset={features.pinResetDefault}
                onChange={(p) => stageI2sBckPinSlave(s, p)}
              />
            </span>
            <span class="hint">LRCLK GP{effBckPinSlave + 1}</span>
          </div>
        {/if}
      {/if}
    </div>

    {#if features.i2sSlaveClock && effClockMode === 1}
      <div class="subhdr">I2S SLAVE STATUS</div>
      {#if !isI2sSource}
        <p class="hint idle">Source is not I2S — clock stays inactive.</p>
      {:else if slaveStatus}
        <div class="kvgrid">
          <KV label="STATE" value={SLAVE_STATE_LABELS[slaveStatus.state] ?? 'UNKNOWN'} tone={slaveStateTone(slaveStatus.state)} />
          <KV label="RATE" value={fmtRate(slaveStatus.detectedRateHz)} />
        </div>
      {:else}
        <p class="hint idle">Waiting for I2S slave status…</p>
      {/if}
    {/if}
  {/if}
</Panel>

<style>
  .rows { padding: 14px; display: grid; grid-template-columns: 3rem max-content max-content; gap: 8px 10px; align-items: center; justify-content: space-between; }
  .row { display: grid; grid-template-columns: subgrid; grid-column: 1 / -1; align-items: center; }
  .rows > .hint { grid-column: 1 / -1; }
  .idle { padding: 6px 14px 10px; }
</style>
