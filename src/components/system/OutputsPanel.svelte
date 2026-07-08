<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import SegmentedSelect from '@/components/chrome/SegmentedSelect.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import PinSelect from './PinSelect.svelte';
  import SaveOutputConfigButton from './SaveOutputConfigButton.svelte';
  import { connection } from '@/state';
  import { stageOutputType, stageOutputDataPin, setOutputPairEnabled, setOutputEnabled } from '@/runtime';
  import { availablePinsFor, channelLayoutById, ChannelId, OutputSlotType, liveCsPinConfigs, type I2sPairSlot, type OutputSlot } from '@/domain';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();

  const snap = $derived(s.mirror.current);
  const overlaySnap = $derived(snap ? s.staging.overlaySnapshot(snap) : null);
  const connected = $derived(connection.connected);
  const ctrlPins = $derived({ uart: s.ctrlIfaces.uart, i2c: s.ctrlIfaces.i2c, cs: liveCsPinConfigs(s.controlSurfaces.bindings, s.controlSurfaces.status) });

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

  function pairEnabled(pair: number): boolean {
    if (!snap) return false;
    return snap.outputs.some((o) => (o.wireIndex === pair * 2 || o.wireIndex === pair * 2 + 1) && o.enabled);
  }

  // PDM and the "Core-1 EQ" outputs (every slot except pair 0 and PDM itself)
  // are mutually exclusive on the wire -- a conflicting SET_OUTPUT_ENABLE is
  // silently dropped by firmware, so the interlock must disable the toggles,
  // not just style them.
  // Firmware only blocks ENABLING across the interlock; switching off always
  // works, so an already-on toggle stays operable.
  function pairLockedByPdm(pair: number): boolean {
    if (!snap || !pdmEnabled || pairEnabled(pair)) return false;
    const wireL = pair * 2;
    return wireL >= 2 && wireL <= snap.platform.pdmOutputIndex - 1;
  }
  const pdmLockedByOutputs = $derived(
    snap && !pdmEnabled
      ? snap.outputs.some((o) => o.wireIndex >= 2 && o.wireIndex <= snap.platform.pdmOutputIndex - 1 && o.enabled)
      : false,
  );
  const pdmLockTitle = $derived(
    numSpdif > 2 ? `unavailable while outputs 2–${numSpdif} are active` : 'unavailable while output 2 is active',
  );

  function onPairToggle(pair: number, next: boolean): void {
    setOutputPairEnabled(s, pair as I2sPairSlot, next);
  }
  function onPdmToggle(next: boolean): void {
    if (!snap) return;
    setOutputEnabled(s, snap.platform.pdmOutputIndex as OutputSlot, next);
  }

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
          <span title={pairLockedByPdm(slot) ? 'unavailable while PDM subwoofer is active' : undefined}>
            <ToggleSwitch
              size="sm"
              checked={pairEnabled(slot)}
              disabled={!connected || pairLockedByPdm(slot)}
              ariaLabel={`Out ${slot + 1} enable`}
              onChange={(v) => onPairToggle(slot, v)}
            />
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
        <span title={pdmLockedByOutputs ? pdmLockTitle : undefined}>
          <ToggleSwitch
            size="sm"
            checked={pdmEnabled}
            disabled={!connected || pdmLockedByOutputs}
            ariaLabel="PDM sub enable"
            onChange={onPdmToggle}
          />
        </span>
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
        <div class="hint">Disable the PDM output to reassign its pin.</div>
      {/if}
    </div>
  {/if}
</Panel>

<style>
  .rows { padding: 14px; display: grid; grid-template-columns: max-content max-content max-content max-content; gap: 8px 10px; align-items: center; justify-content: space-between; }
  .row { display: grid; grid-template-columns: subgrid; grid-column: 1 / -1; align-items: center; }
  .rows > .hint { grid-column: 1 / -1; }
  .lbl { display: flex; align-items: baseline; gap: 11px; }
  .pair { font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.5px; color: var(--text-faint); }
  .fixed { font-family: var(--font-mono); font-size: 10px; color: var(--text-faint); }
</style>
