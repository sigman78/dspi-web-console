<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import SegmentedSelect from '@/components/chrome/SegmentedSelect.svelte';
  import PinSelect from './PinSelect.svelte';
  import { connection } from '@/state';
  import { setI2sBckPin, setMckEnabled, setMckPin, setMckMultiplier } from '@/runtime';
  import { validBckPins, availablePinsFor, OutputSlotType } from '@/domain';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();

  const snap = $derived(s.mirror.current);
  const connected = $derived(connection.connected);
  const anyI2s = $derived(snap?.i2s?.outputSlotTypes.some((t) => t === OutputSlotType.I2s) ?? false);
  const rate = $derived(s.telemetry.info?.sampleRateHz ?? 0);
  const allow256 = $derived(rate < 96000);

  const bckCandidates = $derived(
    snap ? validBckPins(snap.platform.type, snap).map((pin) => ({ pin, usedBy: null })) : [],
  );
  const multOpts = $derived([
    { value: 0, label: '128×' },
    { value: 1, label: '256×', disabled: !allow256 },
  ]);

</script>

<Panel code="SY.08" title="I2S CLOCK">
  {#if snap?.i2s}
    <div class="rows">
      <div class="row">
        <span class="lbl">BCK</span>
        <PinSelect
          value={snap.i2s.bckPin}
          candidates={bckCandidates}
          ariaLabel="I2S BCK pin"
          disabled={!connected || anyI2s}
          onChange={(p) => void setI2sBckPin(s, p)}
        />
        <span class="derived">LRCLK GP{snap.i2s.bckPin + 1}</span>
      </div>
      {#if anyI2s}
        <div class="hint">Set all slots to SPDIF to change BCK.</div>
      {/if}

      <div class="row">
        <span class="lbl">MCK</span>
        <ToggleSwitch
          size="sm"
          checked={snap.i2s.mckEnabled}
          ariaLabel={snap.i2s.mckEnabled ? 'Disable MCK' : 'Enable MCK'}
          disabled={!connected}
          onChange={(v) => void setMckEnabled(s, v)}
        />
        <PinSelect
          value={snap.i2s.mckPin}
          candidates={availablePinsFor(snap.platform.type, snap, snap.i2s.mckPin)}
          ariaLabel="MCK pin"
          disabled={!connected || snap.i2s.mckEnabled}
          onChange={(p) => void setMckPin(s, p)}
        />
      </div>
      {#if snap.i2s.mckEnabled}
        <div class="hint">Turn MCK off to change its pin.</div>
      {/if}

      <div class="row">
        <span class="lbl">MULT</span>
        <SegmentedSelect
          size="sm"
          value={snap.i2s.mckMultiplierEncoded}
          options={multOpts}
          ariaLabel="MCK multiplier"
          disabled={!connected}
          onChange={(v) => void setMckMultiplier(s, v)}
        />
        {#if !allow256}<span class="hint">256× unavailable ≥96 kHz</span>{/if}
      </div>
    </div>
  {/if}
</Panel>

<style>
  .rows { padding: 14px; display: grid; grid-template-columns: 3rem max-content max-content; gap: 8px 10px; align-items: center; justify-content: space-between; }
  .row { display: grid; grid-template-columns: subgrid; grid-column: 1 / -1; align-items: center; }
  .rows > .hint { grid-column: 1 / -1; }
  .lbl { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 1px; color: var(--text-dim); }
  .derived { font-family: var(--font-mono); font-size: 9px; color: var(--text-faint); }
  .hint { font-family: var(--font-mono); font-size: 9px; color: var(--text-faint); }
</style>
