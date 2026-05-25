<script lang="ts">
  import Panel from '../chrome/Panel.svelte';
  import SegmentedSelect from '../chrome/SegmentedSelect.svelte';
  import PinSelect from './PinSelect.svelte';
  import { dsp, session } from '@/state';
  import { setOutputType, setOutputDataPin } from '@/runtime';
  import { availablePinsFor, type OutputSlot } from '@/domain';

  const snap = $derived(dsp.draft);
  const connected = $derived(session.status === 'connected');

  const TYPE_OPTS: ReadonlyArray<{ value: number; label: string }> = [
    { value: 0, label: 'S/PDIF' },
    { value: 1, label: 'I2S' },
  ];

  const numSpdif = $derived(snap ? snap.outputPins.length - 1 : 0);
  const pdmIndex = $derived(snap ? snap.outputPins.length - 1 : -1);
  const pdmEnabled = $derived(
    snap?.outputs.find((o) => o.wireIndex === snap.platform.pdmOutputIndex)?.enabled ?? false,
  );

  let err = $state('');

  async function changeType(slot: number, type: number) {
    err = '';
    const r = await setOutputType(slot as OutputSlot, type);
    if (!r.ok) err = r.message;
  }
  async function changePin(pinIndex: number, pin: number) {
    err = '';
    const r = await setOutputDataPin(pinIndex, pin);
    if (!r.ok) err = r.message;
  }
</script>

<Panel code="SY.07" title="OUTPUTS">
  {#if snap}
    <div class="rows">
      {#each Array.from({ length: numSpdif }) as _unused, slot (slot)}
        <div class="row">
          <span class="lbl">SLOT {slot + 1}</span>
          <SegmentedSelect
            size="sm"
            value={snap.i2s?.outputSlotTypes[slot] ?? 0}
            options={TYPE_OPTS}
            ariaLabel={`Slot ${slot + 1} output type`}
            disabled={!connected}
            onChange={(t) => changeType(slot, t)}
          />
          <PinSelect
            value={snap.outputPins[slot]}
            candidates={availablePinsFor(snap.platform.type, snap, snap.outputPins[slot])}
            ariaLabel={`Slot ${slot + 1} data pin`}
            disabled={!connected}
            onChange={(p) => changePin(slot, p)}
          />
        </div>
      {/each}

      <div class="row">
        <span class="lbl">PDM SUB</span>
        <span class="fixed">PDM</span>
        <PinSelect
          value={snap.outputPins[pdmIndex]}
          candidates={availablePinsFor(snap.platform.type, snap, snap.outputPins[pdmIndex])}
          ariaLabel="PDM sub data pin"
          disabled={!connected || pdmEnabled}
          onChange={(p) => changePin(pdmIndex, p)}
        />
      </div>
      {#if pdmEnabled}
        <div class="hint">Disable the PDM output (Mixer) to reassign its pin.</div>
      {/if}
      {#if err}<div class="err">{err}</div>{/if}
    </div>
  {/if}
</Panel>

<style>
  .rows { padding: 14px; display: grid; gap: 8px; }
  .row { display: grid; grid-template-columns: 4rem auto auto; gap: 10px; align-items: center; }
  .lbl { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 1px; color: var(--text-dim); }
  .fixed { font-family: var(--font-mono); font-size: 10px; color: var(--text-faint); }
  .hint { font-family: var(--font-mono); font-size: 9px; color: var(--text-faint); }
  .err { font-family: var(--font-mono); font-size: 9px; color: var(--err); }
</style>
