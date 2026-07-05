<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import SegmentedSelect from '@/components/chrome/SegmentedSelect.svelte';
  import PinSelect from './PinSelect.svelte';
  import SaveOutputConfigButton from './SaveOutputConfigButton.svelte';
  import { connection } from '@/state';
  import { stageOutputType, stageOutputDataPin } from '@/runtime';
  import { availablePinsFor, channelLayoutById, ChannelId, OutputSlotType, type I2sPairSlot } from '@/domain';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();

  const snap = $derived(s.mirror.current);
  const overlaySnap = $derived(snap ? s.staging.overlaySnapshot(snap) : null);
  const connected = $derived(connection.connected);
  const ctrlPins = $derived({ uart: s.ctrlIfaces.uart, i2c: s.ctrlIfaces.i2c });

  function effOutputType(slot: number): number {
    return s.staging.valueOf(`outputType:${slot}`, snap?.i2s?.outputSlotTypes[slot] ?? OutputSlotType.Spdif);
  }
  function effOutputPin(index: number): number {
    return s.staging.valueOf(`outputPin:${index}`, snap?.outputPins[index] ?? 0);
  }

  // Each SPDIF slot is a stereo output pair (OUT n -> nL / nR).
  function pairShort(slot: number): string {
    const lId = (ChannelId.Out1L + slot * 2) as ChannelId;
    return `${channelLayoutById(lId).shortName} / ${channelLayoutById((lId + 1) as ChannelId).shortName}`;
  }

  const TYPE_OPTS: ReadonlyArray<{ value: number; label: string }> = [
    { value: OutputSlotType.Spdif, label: 'SPDIF' },
    { value: OutputSlotType.I2s, label: 'I2S' },
  ];

  // outputPins = stereo pairs + trailing PDM, so numSpdif <= 4 and the
  // slot index always fits the I2sPairSlot (0|1|2|3) cast below.
  const numSpdif = $derived(snap ? snap.outputPins.length - 1 : 0);
  const pdmIndex = $derived(snap ? snap.outputPins.length - 1 : -1);
  const pdmEnabled = $derived(
    snap?.outputs.find((o) => o.wireIndex === snap.platform.pdmOutputIndex)?.enabled ?? false,
  );

</script>

<Panel code="SY.07" title="OUTPUTS">
  {#snippet right()}<SaveOutputConfigButton />{/snippet}
  {#if snap}
    <div class="rows">
      {#each Array.from({ length: numSpdif }) as _unused, slot (slot)}
        <div class="row">
          <span class="lbl">
            <span class="microlbl">OUT {slot + 1}</span>
            <span class="pair">{pairShort(slot)}</span>
          </span>
          <span class="stage-wrap" class:staged={s.staging.has(`outputType:${slot}`)}>
            <SegmentedSelect
              size="sm"
              value={effOutputType(slot)}
              options={TYPE_OPTS}
              ariaLabel={`Out ${slot + 1} output type`}
              disabled={!connected}
              onChange={(t) => stageOutputType(s, slot as I2sPairSlot, t)}
            />
          </span>
          <span class="stage-wrap" class:staged={s.staging.has(`outputPin:${slot}`)} title={s.staging.has(`outputPin:${slot}`) ? `device: GP${snap.outputPins[slot]}` : undefined}>
            <PinSelect
              value={effOutputPin(slot)}
              candidates={overlaySnap ? availablePinsFor(snap.platform.type, overlaySnap, effOutputPin(slot), ctrlPins) : []}
              ariaLabel={`Out ${slot + 1} data pin`}
              disabled={!connected}
              onChange={(p) => stageOutputDataPin(s, slot, p)}
            />
          </span>
        </div>
      {/each}

      <div class="row">
        <span class="lbl"><span class="microlbl">PDM SUB</span></span>
        <span class="fixed">PDM</span>
        <span class="stage-wrap" class:staged={s.staging.has(`outputPin:${pdmIndex}`)} title={s.staging.has(`outputPin:${pdmIndex}`) ? `device: GP${snap.outputPins[pdmIndex]}` : undefined}>
          <PinSelect
            value={effOutputPin(pdmIndex)}
            candidates={overlaySnap ? availablePinsFor(snap.platform.type, overlaySnap, effOutputPin(pdmIndex), ctrlPins) : []}
            ariaLabel="PDM sub data pin"
            disabled={!connected || pdmEnabled}
            onChange={(p) => stageOutputDataPin(s, pdmIndex, p)}
          />
        </span>
      </div>
      {#if pdmEnabled}
        <div class="hint">Disable the PDM output (Mixer) to reassign its pin.</div>
      {/if}
    </div>
  {/if}
</Panel>

<style>
  .rows { padding: 14px; display: grid; grid-template-columns: max-content max-content max-content; gap: 8px 10px; align-items: center; justify-content: space-between; }
  .row { display: grid; grid-template-columns: subgrid; grid-column: 1 / -1; align-items: center; }
  .rows > .hint { grid-column: 1 / -1; }
  .lbl { display: flex; align-items: baseline; gap: 11px; }
  .pair { font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.5px; color: var(--text-faint); }
  .fixed { font-family: var(--font-mono); font-size: 10px; color: var(--text-faint); }
</style>
