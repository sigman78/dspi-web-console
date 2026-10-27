<script lang="ts">
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import { formatSignedDb } from '@/components/chrome/format';
  import { inputIndexOf, matrixColumns, matrixRows, type ChannelId, type ChannelModel, type InputSlot, type OutputModel, type OutputSlot, type RouteModel } from '@/domain';
  import * as Runtime from '@/runtime';
  import { chShade } from '@/styles/palette';
  import { getSession } from '@/components/sessionContext';
  import CrosspointPopover from '../program/CrosspointPopover.svelte';
  import InspectorSection from './InspectorSection.svelte';

  const { channel, output }: { channel: ChannelModel; output: OutputModel | null } = $props();

  const s = getSession();
  const snap = $derived(s.mirror.current);
  const upmixCtx = $derived(
    s.device.capabilities.features.upmix && snap?.upmix
      ? { enabled: snap.upmix.enabled, surroundMode: snap.upmix.surroundMode }
      : null,
  );

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

  type Pick = { key: string; proposal: boolean; input: InputSlot; output: OutputSlot; title: string; x: number; anchorX: number; y: number; yAbove: number; boundsW: number; boundsH: number; anchor: HTMLElement };
  let pick = $state<Pick | null>(null);

  // The popover is absolutely positioned against the nearest positioned
  // ancestor (the Tune view), which is wider than the inspector column.
  function open(ev: MouseEvent, e: Entry) {
    if (pick?.key === e.key) {
      closePick();
      return;
    }
    const anchor = ev.currentTarget as HTMLElement;
    const host = (anchor.offsetParent as HTMLElement | null) ?? anchor.parentElement;
    if (!host) return;
    const a = anchor.getBoundingClientRect();
    const box = host.getBoundingClientRect();
    const cx = a.left - box.left + a.width / 2;
    pick = {
      key: e.key,
      proposal: e.cell?.enabled !== true,
      input: e.input,
      output: e.output,
      title: output ? `${e.name} → ${channel.name}` : `${channel.name} → ${e.name}`,
      x: cx - 150,
      anchorX: cx,
      y: a.bottom - box.top + 6,
      yAbove: a.top - box.top - 6,
      boundsW: host.clientWidth,
      boundsH: host.clientHeight,
      anchor,
    };
  }

  function closePick(refocus = true) {
    const anchor = pick?.anchor;
    pick = null;
    if (refocus) anchor?.focus();
  }

  const caption = $derived(output ? (output.enabled ? 'matrix column' : 'output disabled') : 'matrix row');
</script>

<InspectorSection title="Sources" {caption}>
  {#each entries as e (e.key)}
    {@const on = e.cell?.enabled ?? false}
    {@const anchored = pick?.key === e.key}
    <div class="row" class:anchored>
      <span class="dot" style:background={chShade(e.id, 'bright')}></span>
      <span class="name">{e.name}</span>
      <span class="gain" class:off={!on}>{on && e.cell ? formatSignedDb(e.cell.gainDb) : '—'}</span>
      <span class="inv" title={on && e.cell?.invert ? 'Phase inverted' : undefined}>{on && e.cell?.invert ? '⌽' : ''}</span>
      <ToggleSwitch
        checked={on}
        ariaLabel={`Route ${e.name}`}
        onChange={(v) => Runtime.setCrosspointEnabled(s, e.input, e.output, v)}
      />
      <button
        type="button"
        class="edit dotbtn"
        aria-label={`Edit route ${e.name}`}
        aria-haspopup="dialog"
        aria-expanded={anchored}
        title={on ? 'Edit route' : 'Add route'}
        onclick={(ev) => open(ev, e)}
      >✎</button>
    </div>
  {/each}
  {#if pick && entries.some((e) => e.key === pick!.key)}
    {#key pick.key}
      <CrosspointPopover
        proposal={pick.proposal}
        input={pick.input}
        output={pick.output}
        title={pick.title}
        x={pick.x}
        anchorX={pick.anchorX}
        y={pick.y}
        yAbove={pick.yAbove}
        boundsW={pick.boundsW}
        boundsH={pick.boundsH}
        onClose={closePick}
      />
    {/key}
  {/if}
</InspectorSection>

<style>
  .row {
    display: grid;
    grid-template-columns: 8px minmax(0, 1fr) 40px 14px 30px 22px;
    align-items: center;
    gap: 8px;
    height: 24px;
    padding: 0 4px;
    font-family: var(--font-sans);
    font-size: 11px;
  }
  .dot { width: 6px; height: 6px; border-radius: 50%; }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
  .gain { text-align: right; font-family: var(--font-mono); color: var(--text-dim); font-variant-numeric: tabular-nums; }
  .gain.off { color: var(--text-faint); }
  .inv { text-align: center; color: var(--text-dim); }
  .edit {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 20px;
    padding: 0;
    border-radius: var(--radius-s);
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-dim);
    cursor: pointer;
  }
  .edit:hover, .anchored .edit { color: var(--text); background: var(--wash); }
</style>
