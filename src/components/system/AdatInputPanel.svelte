<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import KV from '@/components/chrome/KV.svelte';
  import PinSelect from './PinSelect.svelte';
  import { connection } from '@/state';
  import { setAdatInputEnable, setAdatInputPin, setAdatInputClockMode } from '@/runtime';
  import { AudioInputSource, AdatInputLockState, availablePinsFor, liveCsPinConfigs } from '@/domain';
  import { formatRateKHz } from '@/utils';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();

  const connected = $derived(connection.connected);
  const snap = $derived(s.mirror.current);
  const inputConfig = $derived(snap?.inputConfig);
  const status = $derived(s.telemetry.adatInputStatus);
  const features = $derived(s.device.capabilities.features);
  const ctrlPins = $derived({ uart: s.ctrlIfaces.uart, i2c: s.ctrlIfaces.i2c, cs: liveCsPinConfigs(s.controlSurfaces.bindings, s.controlSurfaces.status) });

  const enabled = $derived(inputConfig?.adatInputEnabled ?? false);
  const pin = $derived(inputConfig?.adatInputPin ?? 0);
  const clockMode = $derived(inputConfig?.adatInputClockMode ?? 0);

  // Unlike ADAT output, there is no default GPIO for the input -- firmware
  // rejects an enable write carrying pin 0, so the toggle stays blocked until
  // a pin is assigned. Disable is separately refused while ADAT is the live
  // or staged input source (source switch has to move off it first).
  const stagedSource = $derived(inputConfig ? s.staging.valueOf('inputSource', inputConfig.source) : AudioInputSource.Usb);
  const isAdatSource = $derived(inputConfig?.source === AudioInputSource.Adat || stagedSource === AudioInputSource.Adat);
  const enableBlocked = $derived(!enabled && pin === 0);
  const disableBlocked = $derived(enabled && isAdatSource);
  const toggleTitle = $derived(
    enableBlocked ? 'Assign a GPIO pin first' : disableBlocked ? 'Switch the input source away first' : undefined,
  );

  // The input pin may double as the ADAT output's own pin -- looping OUT
  // straight back into IN is a supported zero-hardware self test, so a pin
  // the output claims stays selectable here. Pin 0 (the wire's "unset"
  // sentinel for this target) is never a real candidate.
  const overlaySnap = $derived(snap ? s.staging.overlaySnapshot(snap) : null);
  const pinCandidates = $derived(
    snap && overlaySnap
      ? availablePinsFor(snap.platform.type, overlaySnap, pin, ctrlPins)
          .filter((c) => c.pin !== 0)
          .map((c) => (c.usedBy === 'ADAT' ? { ...c, usedBy: null, role: null } : c))
      : [],
  );

  const STATE_LABELS: Record<number, string> = {
    [AdatInputLockState.Inactive]:  'INACTIVE',
    [AdatInputLockState.Acquiring]: 'ACQUIRING',
    [AdatInputLockState.Syncing]:   'SYNCING',
    [AdatInputLockState.Locked]:    'LOCKED',
    [AdatInputLockState.Relocking]: 'RELOCKING',
  };

  function stateTone(state: number): 'ok' | 'off' | undefined {
    if (state === AdatInputLockState.Locked) return 'ok';
    if (state === AdatInputLockState.Inactive) return 'off';
    return undefined;
  }
</script>

<Panel code="SY.15" title="ADAT INPUT">
  {#snippet right()}
    <span title={toggleTitle}>
      <ToggleSwitch
        size="sm"
        checked={enabled}
        disabled={!connected || !inputConfig || enableBlocked || disableBlocked}
        ariaLabel={enabled ? 'Disable ADAT input' : 'Enable ADAT input'}
        onChange={(v) => setAdatInputEnable(s, v)}
      />
    </span>
  {/snippet}

  {#if inputConfig && snap}
    <div class="rows">
      <div class="row">
        <span class="microlbl">GPIO PIN</span>
        <PinSelect
          value={pin}
          candidates={pinCandidates}
          placeholder="UNSET"
          ariaLabel="ADAT input GPIO pin"
          disabled={!connected}
          allowReset={features.pinResetDefault && !enabled && pin !== 0}
          resetLabel="CLEAR"
          onChange={(p) => setAdatInputPin(s, p)}
        />
      </div>
      <p class="hint">May share the ADAT output's pin — wiring OUT back into IN is a supported loopback self-test.</p>

      <div class="row">
        <span class="microlbl">CLOCK</span>
        <div class="src-btns">
          <button
            class="chip"
            class:on={clockMode === 0}
            onclick={() => setAdatInputClockMode(s, 0)}
            disabled={!connected || clockMode === 0}
          >MASTER</button>
          <button
            class="chip"
            class:on={clockMode === 1}
            onclick={() => setAdatInputClockMode(s, 1)}
            disabled={!connected || clockMode === 1}
          >SLAVE</button>
        </div>
      </div>
    </div>

    {#if enabled}
      <div class="subhdr">ADAT INPUT STATUS</div>
      {#if status}
        <div class="kvgrid">
          <KV
            label="STATE"
            value={STATE_LABELS[status.state] ?? 'UNKNOWN'}
            tone={stateTone(status.state)}
          />
          <KV
            label="RATE"
            value={status.rateOk ? formatRateKHz(status.detectedRateHz) : 'PARKED — RATE > 48 KHZ'}
            tone={status.rateOk ? undefined : 'warn'}
          />
          <KV label="LOCKS" value={String(status.lockCount)} />
          <KV label="LOSSES" value={String(status.lossCount)} tone={status.lossCount > 0 ? undefined : 'off'} />
          <KV label="SLIP" value={String(status.slipCount)} tone={status.slipCount > 0 ? 'warn' : undefined} />
          <KV label="HDR ERR" value={String(status.headerErr)} tone={status.headerErr > 0 ? undefined : 'off'} />
        </div>
      {:else}
        <p class="hint idle">Waiting for ADAT input status…</p>
      {/if}
    {/if}
  {/if}
</Panel>

<style>
  .rows { padding: 14px; display: flex; flex-direction: column; gap: 8px; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .src-btns { display: flex; gap: 4px; }
  .hint { padding: 0 0 4px; }
  .idle { padding: 6px 14px 10px; }
</style>
