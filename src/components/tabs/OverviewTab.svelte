<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import KV from '@/components/chrome/KV.svelte';
  import QuickRefPanel from './overview/QuickRefPanel.svelte';
  import BodePlot from '@/components/bode/BodePlot.svelte';
  import { overviewCurves as computeOverviewCurves } from '@/components/bode/overviewCurves';
  import { getSession } from '@/components/sessionContext';
  import { matrixRows, ChannelId, inputIndexOf, CrossfeedPreset } from '@/domain';
  import { chKey } from '@/styles/palette';

  const s = getSession();
  const snap = $derived(s.mirror.current);
  const rows = $derived(matrixRows(snap));

  // Names live on channels[] only; join by id for output-shaped rows.
  const nameById = $derived(new Map((snap?.channels ?? []).map((c) => [c.id, c.name])));

  function preampOffsetFor(c: { id: ChannelId; isOutput: boolean }): number {
    if (c.isOutput) return 0;
    const idx = inputIndexOf(c.id);
    if (idx === null) return 0;
    return snap?.inputPreampDb[idx] ?? 0;
  }

  // Both inputs always, plus enabled outputs. Muted ones still draw -- the
  // curve reflects EQ shape, not audibility.
  const activeChannels = $derived.by(() => {
    if (!snap) return [];
    const enabledOutIds = new Set(
      snap.outputs.filter((o) => o.enabled).map((o) => o.id),
    );
    return snap.channels.filter(
      (c) => !c.isOutput || enabledOutIds.has(c.id),
    );
  });

  const overviewCurves = $derived(computeOverviewCurves(activeChannels, preampOffsetFor));

  function fmtDb(v: number, signed = true): string {
    return `${signed && v >= 0 ? '+' : ''}${v.toFixed(1)}`;
  }

  // Labels match CrossfeedPanel so the State pane and Processing tab read alike.
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
                  {(nameById.get(cell.outputId) ?? '').replace(/^Out /, '')} {fmtDb(cell.gainDb)}dB
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
          <div class="outrow">
            <span class="oid ch-{chKey(out.id)}">{out.shortName}</span>
            <span class="oname">{nameById.get(out.id) ?? ''}</span>
            <span class="ogain">{fmtDb(out.gainDb)} dB</span>
            <span class="odelay">{out.delayMs.toFixed(1)} ms</span>
            <span
              class="oclip"
              class:on={s.telemetry.clipLatched[out.id]}
              title={s.telemetry.clipLatched[out.id] ? `${out.shortName} · CLIPPED` : ''}
            >{s.telemetry.clipLatched[out.id] ? '●' : '·'}</span>
            <span class="ostatus" class:mute={out.muted} class:on={out.enabled && !out.muted}>
              {out.muted ? '✕' : out.enabled ? '●' : '○'}
            </span>
          </div>
        {/each}
      </div>
    </Panel>

    <QuickRefPanel />
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
    border-radius: var(--radius-s);
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
    border-radius: var(--radius-s);
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
    border-radius: var(--radius-s);
    color: var(--bg);
    background: var(--ch-base);
    border: 1px solid var(--ch-dim);
  }

  .outlist { padding: 4px 0; }
  .outrow {
    display: grid;
    grid-template-columns: 60px 1fr 70px 70px 24px 24px;
    align-items: center; gap: 8px;
    padding: 6px 14px;
    font-family: var(--font-mono);
    font-size: 10px;
    border-top: 1px solid var(--wash);
  }
  /* U-P3 policy B: no whole-row dim for a disabled output. This row is only
     read-only values (name/gain/delay/clip/status), which stay full-contrast
     per policy; the ostatus glyph (·/●/✕) already carries the off/on/muted
     signal, so no separate control-dim layer is needed here either. */
  .oid { color: var(--ch-bright); font-weight: 600; }
  .oname { font-family: var(--font-sans); color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ogain, .odelay { text-align: right; }
  .oclip { text-align: center; color: var(--text-faint); }
  .oclip.on { color: var(--err); text-shadow: 0 0 4px var(--err); }
  .ostatus { text-align: center; color: var(--text-faint); }
  .ostatus.on { color: var(--ok); }
  .ostatus.mute { color: var(--err); }
</style>
