<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import KV from '@/components/chrome/KV.svelte';
  import PinPicker from '@/components/chrome/PinPicker.svelte';
  import * as Runtime from '@/runtime';
  import * as Domain from '@/domain';
  import { Wire } from '@/protocol';
  import { formatRateKHz } from '@/utils';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();

  const live = $derived(s.mirror.current);
  const snap = $derived(live ? s.staging.overlaySnapshot(live) : null);
  const inputConfig = $derived(snap?.inputConfig);
  const status = $derived(s.telemetry.adatInputStatus);
  const ctrlPins = $derived(Runtime.stagedCtrlPins(s));

  const enabled = $derived(inputConfig?.adatInputEnabled ?? false);
  const pin = $derived(inputConfig?.adatInputPin ?? 0);
  const clockMode = $derived(inputConfig?.adatInputClockMode ?? 0);

  // The input pin may double as the ADAT output's own pin -- looping OUT
  // straight back into IN is a supported zero-hardware self test, so a pin
  // the output claims stays selectable here. Pin 0 (the wire's "unset"
  // sentinel for this target) is never a real candidate.
  const pinCells = $derived(
    snap
      ? Domain.pickerCells(snap.platform.type, snap, ctrlPins, pin).map((c) => {
          if (c.use?.label === 'ADAT') return { ...c, use: null, selectable: true, reason: null };
          if (c.pin === 0) return { ...c, selectable: false, reason: 'reserved as the UNSET sentinel' };
          return c;
        })
      : [],
  );

  const STATE_LABELS: Record<number, string> = {
    [Domain.AdatInputLockState.Inactive]:  'INACTIVE',
    [Domain.AdatInputLockState.Acquiring]: 'ACQUIRING',
    [Domain.AdatInputLockState.Syncing]:   'SYNCING',
    [Domain.AdatInputLockState.Locked]:    'LOCKED',
    [Domain.AdatInputLockState.Relocking]: 'RELOCKING',
  };

  function stateTone(state: number): 'ok' | 'off' | undefined {
    if (state === Domain.AdatInputLockState.Locked) return 'ok';
    if (state === Domain.AdatInputLockState.Inactive) return 'off';
    return undefined;
  }
</script>

<Panel title="ADAT INPUT">
  {#snippet right()}
    {#if !enabled && pin !== 0}
      <button
        class="chip icon"
        title="Clear the stored pin"
        aria-label="Clear ADAT input pin"
        onclick={() => Runtime.stageAdatInputPin(s, Wire.Const.PIN_RESET_TO_DEFAULT)}
      >↺</button>
    {/if}
  {/snippet}

  {#if inputConfig && snap}
    <div class="rows">
      <div class="row">
        <span class="microlbl">GPIO PIN</span>
        <span class="stage-wrap" class:staged={s.staging.has('adatInputPin')}>
          <PinPicker
            value={pin}
            cells={pinCells}
            placeholder="UNSET"
            ariaLabel="ADAT input GPIO pin"
            onChange={(p) => Runtime.stageAdatInputPin(s, p)}
          />
        </span>
      </div>
      <p class="hint">May share the ADAT output's pin — wiring OUT back into IN is a supported loopback self-test.</p>

      <div class="row">
        <span class="microlbl">CLOCK</span>
        <span class="stage-wrap" class:staged={s.staging.has('adatInputClock')}>
          <div class="src-btns">
            <button
              class="chip"
              class:on={clockMode === 0}
              onclick={() => Runtime.stageAdatInputClockMode(s, 0)}
              disabled={clockMode === 0}
            >MASTER</button>
            <button
              class="chip"
              class:on={clockMode === 1}
              onclick={() => Runtime.stageAdatInputClockMode(s, 1)}
              disabled={clockMode === 1}
            >SLAVE</button>
          </div>
        </span>
      </div>
    </div>

    {#if live?.inputConfig.adatInputEnabled}
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
