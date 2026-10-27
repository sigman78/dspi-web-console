<script lang="ts">
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import ValueField from '@/components/chrome/ValueField.svelte';
  import { Mix, inputIndexOf, matrixColumns, matrixRows, type ChannelId, type ChannelModel, type InputSlot, type OutputModel, type OutputSlot, type RouteModel } from '@/domain';
  import * as Runtime from '@/runtime';
  import { chShade } from '@/styles/palette';
  import { getSession } from '@/components/sessionContext';
  import InspectorSection from './InspectorSection.svelte';

  const { channel, output }: { channel: ChannelModel; output: OutputModel | null } = $props();

  const s = getSession();
  const snap = $derived(s.mirror.current);
  const upmixCtx = $derived(
    s.device.capabilities.features.upmix && snap?.upmix
      ? { enabled: snap.upmix.enabled, surroundMode: snap.upmix.surroundMode }
      : null,
  );
  const GAIN_STEP_DB = 0.1;

  type Entry = { key: string; id: ChannelId; name: string; input: InputSlot; output: OutputSlot; cell: RouteModel | undefined };

  const entries = $derived.by<Entry[]>(() => {
    const rows = matrixRows(snap, s.telemetry.activeInputChannels, upmixCtx);
    if (output) {
      // A disabled output has no matrix column; its crosspoints still exist.
      const routes = (snap?.routes ?? []).filter((r) => r.outputWireIndex === output.wireIndex);
      return rows.map((r) => ({
        key: String(r.inputIndex),
        id: r.inputId,
        name: r.label,
        input: r.inputIndex,
        output: output.wireIndex,
        cell: routes.find((c) => c.inputIndex === r.inputIndex),
      }));
    }
    const slot = inputIndexOf(channel.id);
    const row = slot !== null ? rows.find((r) => r.inputIndex === slot) : undefined;
    if (!row) return [];
    return matrixColumns(snap).map((c) => ({
      key: String(c.wireIdx),
      id: c.id,
      name: c.name,
      input: row.inputIndex,
      output: c.wireIdx,
      cell: row.cells.find((r) => r.outputWireIndex === c.wireIdx),
    }));
  });

  const caption = $derived(output ? (output.enabled ? 'matrix column' : 'output disabled') : 'matrix row');
</script>

<InspectorSection title="Sources" {caption}>
  {#each entries as e (e.key)}
    {@const on = e.cell?.enabled ?? false}
    <div class="row">
      <span class="dot" style:background={chShade(e.id, 'bright')}></span>
      <span class="name">{e.name}</span>
      <ToggleSwitch
        checked={on}
        ariaLabel={`Route ${e.name}`}
        onChange={(v) => Runtime.setCrosspointEnabled(s, e.input, e.output, v)}
      />
      <span class="gain">
        {#if e.cell && on}
          <ValueField
            kind="dB-signed"
            tone="signed"
            precision={1}
            min={Mix.CROSSPOINT_GAIN_MIN_DB}
            max={Mix.CROSSPOINT_GAIN_MAX_DB}
            step={GAIN_STEP_DB}
            value={e.cell.gainDb}
            onChange={(v) => Runtime.setCrosspointGain(s, e.input, e.output, v)}
          />
        {:else}
          <span class="none">—</span>
        {/if}
      </span>
      <button
        type="button"
        class="chip hi"
        class:on={e.cell?.invert ?? false}
        aria-pressed={e.cell?.invert ?? false}
        title="Invert phase"
        disabled={!on}
        onclick={() => Runtime.setCrosspointInvert(s, e.input, e.output, !(e.cell?.invert ?? false))}
      >⌽</button>
    </div>
  {/each}
</InspectorSection>

<style>
  .row {
    display: grid;
    grid-template-columns: 8px minmax(0, 1fr) 30px 74px 26px;
    align-items: center;
    gap: 8px;
    height: 24px;
    padding: 0 4px;
    font-family: var(--font-sans);
    font-size: 11px;
  }
  .dot { width: 6px; height: 6px; border-radius: 50%; }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
  .none { display: block; text-align: right; padding-right: 8px; font-family: var(--font-mono); font-size: var(--fs-l); color: var(--text-faint); }
  .chip { padding: 0; }
</style>
