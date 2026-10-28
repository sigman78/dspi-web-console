<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import { chKey } from '@/styles/palette';
  import { clearClips } from '@/runtime';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const snap = $derived(s.mirror.current);
  const info = $derived(s.telemetry.info);
  const anyClip = $derived(s.telemetry.clipLatched.some(Boolean));

  const errors = $derived([
    { label: 'POLL ERR', value: s.telemetry.errorCount },
    { label: 'PDM RING OVR', value: info?.pdmRingOverruns },
    { label: 'PDM RING UNR', value: info?.pdmRingUnderruns },
    { label: 'PDM DMA OVR', value: info?.pdmDmaOverruns },
    { label: 'PDM DMA UNR', value: info?.pdmDmaUnderruns },
    { label: 'SPDIF OVR', value: info?.spdifOverruns },
    { label: 'SPDIF UNR', value: info?.spdifUnderruns },
    { label: 'SPDIF STARV', value: info?.spdifStarvationsTotal },
  ]);
  const cpus = $derived([
    { label: 'CPU0', pct: s.telemetry.cpu0 },
    { label: 'CPU1', pct: s.telemetry.cpu1 },
  ]);
</script>

<Panel title="STATS">
  {#snippet right()}
    {#if anyClip}<button class="chip" onclick={() => clearClips(s)} title="Clear latched clip flags">CLEAR</button>{/if}
  {/snippet}
  <div class="rows">
    {#each cpus as c (c.label)}
      <span class="lbl">{c.label}</span>
      <span class="bar"><i class:hot={c.pct > 80} style:width="{Math.max(0, Math.min(100, c.pct))}%"></i></span>
      <span class="val">{c.pct}%</span>
    {/each}
    <span class="lbl">TEMP</span><span></span>
    <span class="val">{info?.tempCDegC != null ? `${(info.tempCDegC / 100).toFixed(1)} °C` : '—'}</span>
    <span class="lbl">STREAMING</span><span></span>
    <span class="val" class:ok={s.telemetry.streaming} class:off={!s.telemetry.streaming}>{s.telemetry.streaming ? 'YES' : 'NO'}</span>
    <span class="lbl">PDM</span><span></span>
    <span class="val" class:ok={s.telemetry.pdmActive} class:off={!s.telemetry.pdmActive}>{s.telemetry.pdmActive ? 'ACTIVE' : 'IDLE'}</span>
    <div class="subhdr">ERRORS</div>
    {#each errors as e (e.label)}
      <span class="lbl">{e.label}</span><span></span>
      <span class="val" class:warn={e.value != null && e.value > 0} class:off={!(e.value != null && e.value > 0)}>{e.value ?? '—'}</span>
    {/each}
  </div>
  <div class="subhdr">CLIP / CHANNEL</div>
  <div class="clipgrid">
    {#each snap?.channels ?? [] as ch (ch.id)}
      <span
        class="clipsq ch-{chKey(ch.id)}"
        class:on={s.telemetry.clipLatched[ch.id]}
        title="{ch.shortName} · {ch.name}{s.telemetry.clipLatched[ch.id] ? ' · CLIPPED' : ''}"
      >{ch.shortName}</span>
    {/each}
  </div>
</Panel>

<style>
  .rows {
    display: grid;
    grid-template-columns: 1fr 56px 64px;
    align-items: center;
    column-gap: 8px;
    padding: 4px 14px 2px;
  }
  .rows > .lbl, .rows > .val, .rows > .bar { min-height: 17px; display: flex; align-items: center; }
  .lbl { font-family: var(--font-sans); font-size: var(--fs-m); color: var(--text-dim); }
  .val { justify-content: flex-end; font-family: var(--font-mono); font-size: 12px; font-weight: 600; color: var(--text); }
  .val.ok { color: var(--ok); }
  .val.off { color: var(--text-faint); }
  .val.warn { color: var(--warn); }
  .bar { height: 4px; }
  .bar i {
    display: block;
    height: 4px;
    background: var(--accent);
    border-radius: var(--radius-xs);
    transition: width 200ms;
  }
  .bar i.hot { background: var(--err); }
  .rows > .subhdr { grid-column: 1 / -1; margin-top: 2px; padding: 4px 0 2px; }
  .clipgrid { display: flex; flex-wrap: wrap; gap: 3px; padding: 4px 14px 8px; }
  .clipsq {
    min-width: 22px;
    padding: 1px 4px;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    text-align: center;
    color: var(--text-faint);
    background: var(--wash);
    border: 1px solid var(--border);
    border-radius: var(--radius-s);
  }
  .clipsq.on {
    color: var(--err);
    background: color-mix(in oklab, var(--err) var(--tint), transparent);
    border-color: color-mix(in oklab, var(--err) var(--tint-edge), transparent);
    box-shadow: 0 0 6px color-mix(in oklab, var(--err) var(--tint-edge), transparent);
  }
</style>
