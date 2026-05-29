<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import Panel from '../chrome/Panel.svelte';
  import KV from '../chrome/KV.svelte';
  import BodePlot, { type BodeCurve } from '../bode/BodePlot.svelte';
  import { filterCurve } from '../bode/filterCurve';
  import { mirror, status } from '@/state';
  import { matrixRows, ChannelId, inputIndexOf, CrossfeedPreset } from '@/domain';
  import { chKey } from '@/styles/palette';

  const snap = $derived(mirror.current);
  const rows = $derived(matrixRows(snap));

  function preampOffsetFor(c: { id: ChannelId; isOutput: boolean }): number {
    if (c.isOutput) return 0;
    const idx = inputIndexOf(c.id);
    if (idx === null) return 0;
    return snap?.inputPreampDb[idx] ?? 0;
  }

  // Channels worth charting: both inputs always, plus every enabled output
  // (muted ones still drawn -- the curve reflects EQ shape, not audibility).
  const activeChannels = $derived.by(() => {
    if (!snap) return [];
    const enabledOutIds = new Set(
      snap.outputs.filter((o) => o.enabled).map((o) => o.id),
    );
    return snap.channels.filter(
      (c) => !c.isOutput || enabledOutIds.has(c.id),
    );
  });

  // Stereo pairs whose curves merge into a single bicolor dashed line when
  // both sides hold identical EQ state.
  const STEREO_PAIRS: ReadonlyArray<readonly [ChannelId, ChannelId]> = [
    [ChannelId.In1L, ChannelId.In1R],
    [ChannelId.Out1L, ChannelId.Out1R],
    [ChannelId.Out2L, ChannelId.Out2R],
    [ChannelId.Out3L, ChannelId.Out3R],
    [ChannelId.Out4L, ChannelId.Out4R],
  ];

  function curvesEqual(a: number[], b: number[]): boolean {
    if (a.length !== b.length) return false;
    const eps = 1e-9;
    for (let i = 0; i < a.length; i++) {
      if (Math.abs(a[i] - b[i]) > eps) return false;
    }
    return true;
  }

  const overviewCurves = $derived.by<BodeCurve[]>(() => {
    const out: BodeCurve[] = [];
    const consumed = new SvelteSet<ChannelId>();
    const byId = new Map(activeChannels.map((c) => [c.id, c]));

    for (const [lId, rId] of STEREO_PAIRS) {
      const l = byId.get(lId), r = byId.get(rId);
      if (!l || !r) continue;
      consumed.add(lId);
      consumed.add(rId);
      const ptsL = filterCurve(l.filters, preampOffsetFor(l));
      const ptsR = filterCurve(r.filters, preampOffsetFor(r));
      if (curvesEqual(ptsL, ptsR)) {
        // Single solid line whose stroke fades L -> R across the plot --
        // a visual cue that both channels share this response.
        out.push({
          id: `ov-${l.id}-${r.id}`,
          label: `${l.shortName}/${r.shortName}`,
          gradientChannelIds: [l.id, r.id],
          points: ptsL,
        });
      } else {
        out.push({ id: `ov-${l.id}`, channelId: l.id, label: l.shortName, points: ptsL });
        out.push({ id: `ov-${r.id}`, channelId: r.id, label: r.shortName, points: ptsR });
      }
    }
    // Singletons (e.g. PDM, or one half of a pair if the other isn't active).
    for (const c of activeChannels) {
      if (consumed.has(c.id)) continue;
      out.push({
        id: `ov-${c.id}`, channelId: c.id, label: c.shortName,
        points: filterCurve(c.filters, preampOffsetFor(c)),
      });
    }
    return out;
  });

  function fmtDb(v: number, signed = true): string {
    return `${signed && v >= 0 ? '+' : ''}${v.toFixed(1)}`;
  }

  // Mirror src/components/processing/CrossfeedPanel.svelte: presets 0..2 are
  // PRESET 1..3, value 3 is CUSTOM. Using identical labels keeps the State
  // pane and the Processing tab readable as a single product.
  const CROSSFEED_PRESET_LABEL: Record<CrossfeedPreset, string> = {
    [CrossfeedPreset.Preset1]: 'PRESET 1',
    [CrossfeedPreset.Preset2]: 'PRESET 2',
    [CrossfeedPreset.Preset3]: 'PRESET 3',
    [CrossfeedPreset.Custom]:  'CUSTOM',
  };

  const crossfeedSummary = $derived.by(() => {
    const cf = snap?.crossfeed;
    if (!cf || !cf.enabled) return 'OFF';
    const label = CROSSFEED_PRESET_LABEL[cf.preset];
    return cf.itd ? `${label} · ITD` : label;
  });
  const loudnessSummary = $derived.by(() => {
    const ld = snap?.loudness;
    if (!ld || !ld.enabled) return 'OFF';
    return `${ld.refSpl.toFixed(0)} dB · ${ld.intensityPct.toFixed(0)}%`;
  });
  const levellerSummary = $derived.by(() => {
    const lv = snap?.leveller;
    if (!lv || !lv.enabled) return 'OFF';
    return `SPEED ${lv.speed} · ${fmtDb(lv.maxGainDb)} dB max`;
  });
  const outputsActive = $derived(snap?.outputs.filter((o) => o.enabled).length ?? 0);
  const outputsTotal = $derived(snap?.outputs.length ?? 0);
</script>

<div class="grid">
  <div class="leftcol">
    <Panel code="OV.01" title="MERGED FILTER RESPONSE · ALL CHANNELS">
      {#snippet right()}
        <div class="legend">
          {#each activeChannels as c (c.id)}
            <span class="lpill ch-{chKey(c.id)}">{c.shortName}</span>
          {/each}
        </div>
      {/snippet}
      <div class="bode-host">
        <BodePlot curves={overviewCurves} height={230} />
      </div>
    </Panel>

    <Panel code="OV.02" title="ROUTING SUMMARY">
      <div class="routing">
        {#each rows as row (row.inputIndex)}
          <div class="route">
            <span class="inp ch-{chKey(row.inputId)}">{row.label}</span>
            <span class="arrow">→</span>
            <div class="targets">
              {#each row.cells.filter((c) => c.enabled) as cell (cell.outputWireIndex)}
                <span class="chip ch-{chKey(cell.outputId)}">
                  {cell.outputName.replace(/^Out /, '')} {fmtDb(cell.gainDb)}dB
                </span>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </Panel>
  </div>

  <div class="rightcol">
    <Panel code="OV.03" title="STATE">
      <div class="kvgrid">
        <KV label="BYPASS"    value={snap?.bypass ? 'ON · dry signal' : 'OFF'} tone={snap?.bypass ? 'ok' : 'off'} />
        <KV label="PREAMP"    value={`${fmtDb(snap?.masterPreampDb ?? 0)} dB`} />
        <KV label="CROSSFEED" value={crossfeedSummary} tone={snap?.crossfeed.enabled ? 'ok' : 'off'} />
        <KV label="LOUDNESS"  value={loudnessSummary} tone={snap?.loudness.enabled ? 'ok' : 'off'} />
        <KV label="LEVELLER"  value={levellerSummary} tone={snap?.leveller?.enabled ? 'ok' : 'off'} />
      </div>
    </Panel>

    <Panel code="OV.04" title="OUTPUT CHANNELS · COMPACT">
      {#snippet right()}
        <span class="meta">{outputsActive} / {outputsTotal} ACTIVE</span>
      {/snippet}
      <div class="outlist">
        {#each snap?.outputs ?? [] as out (out.id)}
          <div class="outrow" class:dim={!out.enabled}>
            <span class="oid ch-{chKey(out.id)}">{out.shortName}</span>
            <span class="oname">{out.name}</span>
            <span class="ogain">{fmtDb(out.gainDb)} dB</span>
            <span class="odelay">{out.delayMs.toFixed(1)} ms</span>
            <span
              class="oclip"
              class:on={status.clipLatched[out.id]}
              title={status.clipLatched[out.id] ? `${out.shortName} · CLIPPED` : ''}
            >{status.clipLatched[out.id] ? '●' : '·'}</span>
            <span class="ostatus" class:mute={out.muted} class:on={out.enabled && !out.muted}>
              {out.muted ? '✕' : out.enabled ? '●' : '○'}
            </span>
          </div>
        {/each}
      </div>
    </Panel>
  </div>
</div>

<style>
  .grid { display: grid; grid-template-columns: 1.6fr 1fr; gap: var(--pad); height: 100%; }
  .leftcol, .rightcol { display: flex; flex-direction: column; gap: var(--pad); min-height: 0; }
  .meta { font-family: var(--font-mono); font-size: 9px; color: var(--text-faint); letter-spacing: 1px; }

  .bode-host {
    padding: 12px 14px 4px;
  }

  .legend {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    justify-content: flex-end;
    max-width: 100%;
  }
  .lpill {
    font-family: var(--font-mono);
    font-size: 9px;
    line-height: 1;
    padding: 3px 6px;
    border-radius: 3px;
    color: var(--bg);
    background: var(--ch-base);
    border: 1px solid var(--ch-dim);
    letter-spacing: 0.5px;
  }

  .routing {
    padding: 14px;
    display: flex; flex-direction: column; gap: 10px;
    font-family: var(--font-mono); font-size: 11px;
  }
  .route { display: flex; align-items: center; gap: 10px; }
  .inp {
    font-size: 9px;
    padding: 2px 6px;
    border-radius: 3px;
    font-weight: 600;
    color: var(--bg);
    background: var(--ch-base);
    border: 1px solid var(--ch-dim);
  }
  .arrow { color: var(--text-dim); }
  .targets { display: flex; gap: 4px; flex-wrap: wrap; flex: 1; }
  .chip {
    font-size: 9px;
    padding: 2px 6px;
    border-radius: 3px;
    color: var(--bg);
    background: var(--ch-base);
    border: 1px solid var(--ch-dim);
  }

  .kvgrid { padding: 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

  .outlist { padding: 4px 0; }
  .outrow {
    display: grid;
    grid-template-columns: 60px 1fr 70px 70px 24px 24px;
    align-items: center; gap: 8px;
    padding: 6px 14px;
    font-family: var(--font-mono);
    font-size: 10px;
    border-top: 1px solid color-mix(in oklab, var(--text) 4%, transparent);
  }
  .outrow.dim { opacity: 0.4; }
  .oid { color: var(--ch-bright); font-weight: 600; }
  .oname { font-family: var(--font-sans); color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ogain, .odelay { text-align: right; }
  .oclip { text-align: center; color: var(--text-faint); }
  .oclip.on { color: var(--err); text-shadow: 0 0 4px var(--err); }
  .ostatus { text-align: center; color: var(--text-faint); }
  .ostatus.on { color: var(--ok); }
  .ostatus.mute { color: var(--err); }
</style>
