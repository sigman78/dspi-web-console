<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import SegmentedSelect from '@/components/chrome/SegmentedSelect.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import PinPicker from '@/components/chrome/PinPicker.svelte';
  import SaveOutputConfigButton from './SaveOutputConfigButton.svelte';
  import * as Runtime from '@/runtime';
  import * as Domain from '@/domain';
  import { Wire } from '@/protocol';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();

  const snap = $derived(s.mirror.current);
  const overlaySnap = $derived(snap ? s.staging.overlaySnapshot(snap) : null);
  const ctrlPins = $derived(Runtime.stagedCtrlPins(s));

  function effOutputType(slot: number): number {
    return s.staging.valueOf(`outputType:${slot}`, snap?.i2s?.outputSlotTypes[slot] ?? Domain.OutputSlotType.Spdif);
  }
  function effOutputPin(index: number): number {
    return s.staging.valueOf(`outputPin:${index}`, snap?.outputPins[index] ?? 0);
  }

  // Each SPDIF slot is a stereo output pair (OUT n -> nL / nR).
  function pairShort(slot: number): string {
    const lId = (Domain.ChannelId.Out1L + slot * 2) as Domain.ChannelId;
    return `${Domain.channelLayoutById(lId).shortName} / ${Domain.channelLayoutById((lId + 1) as Domain.ChannelId).shortName}`;
  }

  const TYPE_OPTS: ReadonlyArray<{ value: number; label: string }> = [
    { value: Domain.OutputSlotType.Spdif, label: 'SPDIF' },
    { value: Domain.OutputSlotType.I2s, label: 'I2S' },
  ];

  // outputPins = stereo pairs + trailing PDM, so numSpdif <= 4 and the
  // slot index always fits the I2sPairSlot (0|1|2|3) cast below.
  const numSpdif = $derived(snap ? snap.outputPins.length - 1 : 0);
  const pdmIndex = $derived(snap ? snap.outputPins.length - 1 : -1);
  const pdmEnabled = $derived(
    overlaySnap?.outputs.find((o) => o.wireIndex === overlaySnap.platform.pdmOutputIndex)?.enabled ?? false,
  );

  function pairEnabled(pair: number): boolean {
    if (!overlaySnap) return false;
    return overlaySnap.outputs.some((o) => (o.wireIndex === pair * 2 || o.wireIndex === pair * 2 + 1) && o.enabled);
  }

  // PDM and the "Core-1 EQ" outputs (every slot except pair 0 and PDM itself)
  // are mutually exclusive on the wire -- a conflicting SET_OUTPUT_ENABLE is
  // silently dropped by firmware, so the interlock must disable the toggles,
  // not just style them.
  // Firmware only blocks ENABLING across the interlock; switching off always
  // works, so an already-on toggle stays operable.
  function pairLockedByPdm(pair: number): boolean {
    if (!overlaySnap || !pdmEnabled || pairEnabled(pair)) return false;
    const wireL = pair * 2;
    return wireL >= 2 && wireL <= overlaySnap.platform.pdmOutputIndex - 1;
  }
  const pdmLockedByOutputs = $derived(
    overlaySnap && !pdmEnabled
      ? overlaySnap.outputs.some((o) => o.wireIndex >= 2 && o.wireIndex <= overlaySnap.platform.pdmOutputIndex - 1 && o.enabled)
      : false,
  );
  const pdmLockTitle = $derived(
    numSpdif > 2 ? `unavailable while outputs 2–${numSpdif} are active` : 'unavailable while output 2 is active',
  );

  const latStatus = $derived(s.outputLatency.status);
  const latOptions = $derived(s.outputLatency.options ?? []);
  const latId = $derived(s.staging.valueOf('outputLatency', latStatus?.requestedId ?? 0));
  const latOption = $derived(latOptions.find((o) => o.id === latId));
  // The firmware stores a stream-only option but runs it as 2 ms on USB.
  // The firmware's effective time round-trips through whole frames (4000 us
  // reads back 3991 at 44.1 kHz), so only a real difference earns the note.
  const RUNS_TOLERANCE_US = 25;
  const latRunsAs = $derived(
    latOption && (!latOption.available || Math.abs(latOption.effectiveUs - latOption.latencyUs) > RUNS_TOLERANCE_US)
      ? `runs ${Domain.formatLatencyMs(latOption.effectiveUs)}${snap?.inputConfig.source === Domain.AudioInputSource.Usb ? ' on USB' : ' now'}`
      : null,
  );

  // PDM's data pin can't be reassigned while the PDM output is active, so
  // resetting it there would only draw a firmware refusal -- skip it.
  function stageOutputPinsToDefault(): void {
    for (let slot = 0; slot < numSpdif; slot++) Runtime.stageOutputDataPin(s, slot, Wire.Const.PIN_RESET_TO_DEFAULT);
    if (!pdmEnabled) Runtime.stageOutputDataPin(s, pdmIndex, Wire.Const.PIN_RESET_TO_DEFAULT);
  }

</script>

<Panel title="OUTPUTS">
  {#snippet right()}
    <button class="chip icon" title="Reset to defaults" aria-label="Reset output pins to defaults" onclick={stageOutputPinsToDefault}>↺</button>
    <SaveOutputConfigButton />
  {/snippet}
  {#if snap}
    <div class="rows">
      {#each Array.from({ length: numSpdif }) as _unused, slot (slot)}
        <div class="row">
          <span class="lbl">
            <span class="microlbl">OUT {slot + 1}</span>
            <span class="pair">{pairShort(slot)}</span>
          </span>
          <span class="stage-wrap" class:staged={s.staging.has(`pairEnable:${slot}`)} title={pairLockedByPdm(slot) ? 'unavailable while PDM subwoofer is active' : undefined}>
            <ToggleSwitch
              checked={pairEnabled(slot)}
              disabled={pairLockedByPdm(slot)}
              ariaLabel={`Out ${slot + 1} enable`}
              onChange={(v) => Runtime.stageOutputPairEnabled(s, slot as Domain.I2sPairSlot, v)}
            />
          </span>
          <span class="stage-wrap" class:staged={s.staging.has(`outputType:${slot}`)}>
            <SegmentedSelect
              value={effOutputType(slot)}
              options={TYPE_OPTS}
              ariaLabel={`Out ${slot + 1} output type`}
              onChange={(t) => Runtime.stageOutputType(s, slot as Domain.I2sPairSlot, t)}
            />
          </span>
          <span class="stage-wrap" class:staged={s.staging.has(`outputPin:${slot}`)} title={s.staging.has(`outputPin:${slot}`) ? `device: GP${snap.outputPins[slot]}` : undefined}>
            <PinPicker
              value={effOutputPin(slot)}
              cells={overlaySnap ? Domain.pickerCells(snap.platform.type, overlaySnap, ctrlPins, effOutputPin(slot)) : []}
              ariaLabel={`Out ${slot + 1} data pin`}
              onChange={(p) => Runtime.stageOutputDataPin(s, slot, p)}
            />
          </span>
        </div>
      {/each}

      <div class="row">
        <span class="lbl"><span class="microlbl">PDM SUB</span></span>
        <span class="stage-wrap" class:staged={s.staging.has('pdmEnable')} title={pdmLockedByOutputs ? pdmLockTitle : undefined}>
          <ToggleSwitch
            checked={pdmEnabled}
            disabled={pdmLockedByOutputs}
            ariaLabel="PDM sub enable"
            onChange={(v) => Runtime.stagePdmEnabled(s, v)}
          />
        </span>
        <span class="fixed">PDM</span>
        <span class="stage-wrap" class:staged={s.staging.has(`outputPin:${pdmIndex}`)} title={s.staging.has(`outputPin:${pdmIndex}`) ? `device: GP${snap.outputPins[pdmIndex]}` : undefined}>
          <PinPicker
            value={effOutputPin(pdmIndex)}
            cells={overlaySnap ? Domain.pickerCells(snap.platform.type, overlaySnap, ctrlPins, effOutputPin(pdmIndex)) : []}
            ariaLabel="PDM sub data pin"
            disabled={pdmEnabled}
            onChange={(p) => Runtime.stageOutputDataPin(s, pdmIndex, p)}
          />
        </span>
      </div>
      {#if pdmEnabled}
        <div class="hint">Disable the PDM output to reassign its pin.</div>
      {/if}

      {#if s.outputLatency.supported === true && latStatus}
        <div class="row latency">
          <span class="lbl"><span class="microlbl">LATENCY</span></span>
          <span class="latctl">
            <span class="stage-wrap" class:staged={s.staging.has('outputLatency')}>
              <select
                class="latsel"
                aria-label="Output latency"
                title="Output latency. Dimmed options need an S/PDIF, I2S or ADAT input; on USB they run as 2 ms."
                disabled={s.outputLatency.busy}
                value={String(latId)}
                onchange={(e) => Runtime.stageOutputLatency(s, Number(e.currentTarget.value))}
              >
                {#each latOptions as o (o.id)}
                  <option value={String(o.id)} class:dim={o.streamOnly && !o.available}>
                    {Domain.formatLatencyMs(o.latencyUs)}
                  </option>
                {/each}
              </select>
            </span>
            {#if latRunsAs}<span class="runs">{latRunsAs}</span>{/if}
          </span>
        </div>
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
  .latctl { grid-column: 2 / -1; display: flex; align-items: center; gap: 8px; }
  .latsel {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 3px 6px;
    background: var(--panel-solid);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-s);
    cursor: pointer;
  }
  .latsel:disabled { opacity: var(--dim-disabled); cursor: default; }
  .latsel option.dim { color: var(--text-faint); }
  .runs { font-family: var(--font-sans); font-size: 11px; color: var(--text-faint); }
  .fixed { font-family: var(--font-mono); font-size: 10px; color: var(--text-faint); }
</style>
