<script lang="ts">
    import BodePlot, { PAD_B, PAD_L, type BodeCurve, type BodeNode } from '@/components/noveau/tune/BodePlot.svelte';
  import { formatValue } from '@/components/chrome/valueFieldFormat';
  import * as Domain from '@/domain';
  import type { ChannelModel, FilterParams, PlotGeometry } from '@/domain';
  import { setEqFilterLinked, setXoverBandLinked } from '@/runtime';
  import { getSession } from '@/components/sessionContext';
  import { noveauUi } from '@/components/noveau/noveauUi.svelte';
  import BandMenu from './BandMenu.svelte';
  import { bandDraft, bandHold, holdBand } from './bandDraft.svelte';
  import { patchBand, clearBand } from './bandOps';
  import * as EqDraft from './eqDraft';
  import { eqLinkView } from './eqLinkView';
  import type { DragAnchor } from './eqDraft';

  const { channel, preampDb }: { channel: ChannelModel; preampDb: number } = $props();

  const s = getSession();
  const types = $derived(Domain.offeredTypes(s.device.capabilities.features));

  // A draft only shows on the channel it was made on.
  const live = $derived.by(() => {
    const d = bandDraft.current ?? bandHold.value;
    return d?.channelId === channel.id ? d : null;
  });
  // Set at the first move of a drag or nudge burst, cleared when it ends.
  let gesture: { id: string; anchor: DragAnchor } | null = null;

  const bands = $derived(
    live?.kind === 'peq' ? channel.filters.map((b, i) => (i === live.index ? live.band : b)) : channel.filters,
  );
  const xover = $derived(
    live?.kind === 'xover' ? channel.xoverBands.map((b, i) => (i === live.index ? live.band : b)) : channel.xoverBands,
  );

  const curve = $derived<BodeCurve>({
    id: `eq-${channel.id}`,
    channelId: channel.id,
    points: Domain.filterCurve(bands, preampDb, xover),
    label: channel.shortName,
    fill: true,
  });
  // Locked peers draw underneath the selected channel from their own mirror state.
  const curves = $derived.by<BodeCurve[]>(() => {
    const snap = s.mirror.current;
    if (!snap) return [curve];
    const peers = eqLinkView(s.eqLink, snap.channels, channel).members.filter((c) => c.id !== channel.id);
    return [
      ...peers.map((c) => {
        const slot = Domain.inputIndexOf(c.id);
        const pre = slot !== null ? (snap.inputPreampDb[slot] ?? 0) : 0;
        return { id: `eq-${c.id}`, channelId: c.id, points: Domain.filterCurve(c.filters, pre, c.xoverBands), label: c.shortName };
      }),
      curve,
    ];
  });

  const nodes = $derived.by<BodeNode[]>(() => {
    const out: BodeNode[] = [];
    bands.forEach((b, i) => {
      if (b.type === Domain.FilterType.Flat) return;
      out.push({
        id: `b${i}`,
        f: b.frequency,
        db: Domain.filterCurveAt(bands, preampDb, b.frequency, xover),
        channelId: channel.id,
        label: String(i + 1),
        shape: 'circle',
        selected: noveauUi.selectedBand === i,
        bypassed: b.bypass,
        lockDb: !Domain.bandHasGain(b.type),
      });
    });
    xover.forEach((b, i) => {
      if (b.type === Domain.FilterType.Flat) return;
      out.push({
        id: `x${i}`,
        f: b.frequency,
        db: Domain.filterCurveAt(bands, preampDb, b.frequency, xover),
        channelId: channel.id,
        label: `X${i + 1}`,
        shape: 'diamond',
        bypassed: b.bypass,
        lockDb: true,
      });
    });
    return out;
  });

  function parseId(id: string): { kind: 'peq' | 'xover'; index: number } {
    return { kind: id[0] === 'x' ? 'xover' : 'peq', index: Number(id.slice(1)) };
  }
  const mirrorBand = (kind: 'peq' | 'xover', i: number): FilterParams | undefined =>
    (kind === 'peq' ? channel.filters : channel.xoverBands)[i];
  const baseBand = (kind: 'peq' | 'xover', i: number): FilterParams =>
    live && live.kind === kind && live.index === i ? live.band : mirrorBand(kind, i)!;

  // A draft that matches the mirror has nothing left to show.
  $effect(() => {
    const d = bandDraft.current;
    if (!d || d.channelId !== channel.id) return;
    const cur = mirrorBand(d.kind, d.index);
    if (cur && EqDraft.sameBand(cur, d.band)) bandDraft.current = null;
  });

  function commitDraft() {
    const d = bandDraft.current;
    if (!d) return;
    bandDraft.current = null;
    const owner = s.mirror.current?.channels.find((c) => c.id === d.channelId);
    const origin = (d.kind === 'peq' ? owner?.filters : owner?.xoverBands)?.[d.index];
    if (origin && EqDraft.sameBand(origin, d.band)) return;
    if (d.kind === 'peq') setEqFilterLinked(s, d.channelId, d.index, { ...d.band });
    else setXoverBandLinked(s, d.channelId, d.index, { ...d.band });
    holdBand(s, d);
  }

  const qCommit = EqDraft.trailingDebounce(commitDraft, 150);

  // A pending draft is written, not dropped, when its channel changes or the
  // view goes away (unless the channel itself is gone).
  $effect(() => {
    void channel.id;
    return () => {
      qCommit.cancel();
      gesture = null;
      const d = bandDraft.current;
      if (d && s.mirror.current?.channels.some((c) => c.id === d.channelId)) commitDraft();
      bandDraft.current = null;
      bandHold.release();
    };
  });

  // Another node's uncommitted draft (e.g. a debounced wheel-Q) is written
  // before a new gesture takes the single draft slot.
  function settleOtherDraft(kind: 'peq' | 'xover', index: number) {
    const d = live;
    if (d && d === bandDraft.current && (d.kind !== kind || d.index !== index)) {
      qCommit.cancel();
      commitDraft();
    }
  }

  function onNodeSelect(id: string) {
    const { kind, index } = parseId(id);
    if (kind === 'peq') noveauUi.selectedBand = index;
  }
  function onNodeDrag(id: string, f: number, db: number) {
    const { kind, index } = parseId(id);
    settleOtherDraft(kind, index);
    const base = baseBand(kind, index);
    if (base.type === Domain.FilterType.LinkwitzTransform) return;
    if (gesture?.id !== id) {
      const node = nodes.find((n) => n.id === id);
      gesture = { id, anchor: { gain: base.gain, db: node?.db ?? db } };
    }
    const band = kind === 'peq' ? EqDraft.applyBandDrag(base, f, db, gesture.anchor) : EqDraft.applyXoverDrag(base, f);
    bandDraft.current = { channelId: channel.id, kind, index, band };
  }
  function onNodeDragEnd(id: string, f: number, db: number) {
    onNodeDrag(id, f, db);
    gesture = null;
    qCommit.cancel();
    commitDraft();
  }
  function onNodeWheel(id: string, deltaY: number) {
    const { kind, index } = parseId(id);
    if (kind !== 'peq') return;
    settleOtherDraft(kind, index);
    const base = baseBand(kind, index);
    const band = EqDraft.applyWheelQ(base, deltaY);
    if (band === base) return;
    bandDraft.current = { channelId: channel.id, kind, index, band };
    qCommit.call();
  }
  function onPlotDblClick(f: number, db: number) {
    const baseline = Domain.filterCurveAt(bands, preampDb, f, xover);
    const plan = EqDraft.planAddBand(channel.filters, f, db - baseline);
    if (!plan) return;
    setEqFilterLinked(s, channel.id, plan.index, plan.band);
    noveauUi.selectedBand = plan.index;
  }

  let wrap = $state<HTMLDivElement | null>(null);
  let wrapW = $state(720);
  let wrapH = $state(0);
  const plotH = $derived(wrapH > 0 ? wrapH : 300);
  const plotW = $derived(Math.max(120, wrapW));

  const geom = $derived<PlotGeometry>({
    padL: PAD_L,
    plotW: plotW - PAD_L,
    plotH: plotH - PAD_B,
    yMin: Domain.Eq.BODE_DB_RANGE[0],
    yMax: Domain.Eq.BODE_DB_RANGE[1],
  });

  const callout = $derived.by(() => {
    const i = noveauUi.selectedBand;
    if (i === null) return null;
    const b = bands[i];
    if (!b || b.type === Domain.FilterType.Flat) return null;
    const f = b.frequency;
    const db = Domain.filterCurveAt(bands, preampDb, f, xover);
    const x = Domain.xForF(Math.min(Domain.Eq.FREQ_MAX_HZ, Math.max(Domain.Eq.FREQ_MIN_HZ, f)), geom);
    const y = Domain.yForDb(Math.min(geom.yMax, Math.max(geom.yMin, db)), geom);
    const parts = [f >= 1000 ? `${(f / 1000).toFixed(2)} kHz` : `${Math.round(f)} Hz`];
    if (Domain.bandHasGain(b.type)) parts.push(`${formatValue('dB-signed', b.gain, 1)} dB`);
    if (Domain.bandHasQ(b.type)) parts.push(`Q ${b.q.toFixed(1)}`);
    return {
      text: parts.join(' · '),
      left: Math.min(Math.max(x - 70, PAD_L + 4), Math.max(PAD_L + 4, plotW - 190)),
      top: Math.max(4, y - 38),
    };
  });

  let menu = $state<{ index: number; x: number; y: number } | null>(null);
  function onNodeContext(id: string, clientX: number, clientY: number) {
    const { kind, index } = parseId(id);
    if (kind !== 'peq' || !wrap) return;
    const r = wrap.getBoundingClientRect();
    noveauUi.selectedBand = index;
    menu = { index, x: clientX - r.left, y: clientY - r.top };
  }
  const menuBand = $derived(menu ? channel.filters[menu.index] : null);
</script>

<div class="graph" bind:this={wrap} bind:clientWidth={wrapW} bind:clientHeight={wrapH}>
  <BodePlot
    {curves}
    height={plotH}
    {nodes}
    {onNodeSelect}
    {onNodeDrag}
    {onNodeDragEnd}
    {onNodeWheel}
    {onNodeContext}
    {onPlotDblClick}
  />
  {#if callout}
    <div class="callout" style:left="{callout.left}px" style:top="{callout.top}px">{callout.text}</div>
  {/if}
  {#if menu && menuBand}
    <BandMenu
      x={menu.x}
      y={menu.y}
      boundsW={wrapW}
      boundsH={wrapH}
      type={menuBand.type}
      bypassed={menuBand.bypass}
      {types}
      onType={(t) => patchBand(s, channel, menu!.index, { type: t })}
      onBypass={() => patchBand(s, channel, menu!.index, { bypass: !menuBand.bypass })}
      onClear={() => clearBand(s, channel, menu!.index)}
      onClose={() => (menu = null)}
    />
  {/if}
</div>

<style>
  .graph {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .callout {
    position: absolute;
    padding: 3px 8px;
    border: 1px solid color-mix(in oklab, var(--accent) 45%, var(--border));
    border-radius: var(--radius-s);
    background: var(--panel-hi);
    font-family: var(--font-mono);
    font-size: 11px;
    white-space: nowrap;
    color: var(--text);
    pointer-events: none;
  }
</style>
