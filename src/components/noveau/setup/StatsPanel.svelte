<script lang="ts">
  import { untrack } from 'svelte';
  import Panel from '@/components/chrome/Panel.svelte';
  import KV from '@/components/chrome/KV.svelte';
  import { chKey } from '@/styles/palette';
  import { clearClips } from '@/runtime';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  // STREAMING and PDM come from the buffer-stats read.
  $effect(() => untrack(() => s.telemetry.wantBufferStats()));
  const snap = $derived(s.mirror.current);
  const info = $derived(s.telemetry.info);
  const anyClip = $derived(s.telemetry.clipLatched.some(Boolean));

  const cpus = $derived([s.telemetry.cpu0, s.telemetry.cpu1]);

  function count(v: number | null | undefined): string {
    return v == null ? '—' : String(v);
  }
  function countTone(...vs: (number | null | undefined)[]): 'warn' | 'off' {
    return vs.some((v) => v != null && v > 0) ? 'warn' : 'off';
  }
</script>

<Panel title="STATS">
  {#snippet right()}
    {#if anyClip}<button class="chip" onclick={() => clearClips(s)} title="Clear latched clip flags">CLEAR</button>{/if}
  {/snippet}
  <div class="kvrows">
    <div class="cpu">
      <div class="lbl">CPU 0 / 1</div>
      {#each cpus as pct, i (i)}
        <span class="bar"><i class:hot={pct > 80} style:width="{Math.max(0, Math.min(100, pct))}%"></i></span>
        <span class="pct">{pct}%</span>
      {/each}
    </div>
    <KV inline label="TEMP" value={info?.tempCDegC != null ? `${(info.tempCDegC / 100).toFixed(1)} °C` : '—'} />
    <KV inline label="STREAMING" value={s.telemetry.streaming ? 'YES' : 'NO'} tone={s.telemetry.streaming ? 'ok' : 'off'} />
    <KV inline label="PDM" value={s.telemetry.pdmActive ? 'ACTIVE' : 'IDLE'} tone={s.telemetry.pdmActive ? 'ok' : 'off'} />
    <KV inline label="POLL ERR" value={String(s.telemetry.errorCount)} tone={countTone(s.telemetry.errorCount)} />
    <KV inline label="PDM RING OVR / UNR" value={`${count(info?.pdmRingOverruns)} / ${count(info?.pdmRingUnderruns)}`} tone={countTone(info?.pdmRingOverruns, info?.pdmRingUnderruns)} />
    <KV inline label="PDM DMA OVR / UNR" value={`${count(info?.pdmDmaOverruns)} / ${count(info?.pdmDmaUnderruns)}`} tone={countTone(info?.pdmDmaOverruns, info?.pdmDmaUnderruns)} />
    <KV inline label="SPDIF OVR / UNR" value={`${count(info?.spdifOverruns)} / ${count(info?.spdifUnderruns)}`} tone={countTone(info?.spdifOverruns, info?.spdifUnderruns)} />
    <KV inline label="SPDIF STARV" value={count(info?.spdifStarvationsTotal)} tone={countTone(info?.spdifStarvationsTotal)} />
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
  .kvrows { padding: 4px 0; }
  .cpu {
    display: grid;
    grid-template-columns: 1fr 40px 36px 40px 36px;
    align-items: center;
    column-gap: 6px;
    min-height: 22px;
    padding: 0 14px;
  }
  .lbl { font-family: var(--font-sans); font-size: var(--fs-m); color: var(--text-dim); }
  .pct { text-align: right; font-family: var(--font-mono); font-size: 12px; font-weight: 600; color: var(--text); }
  .bar { display: block; height: 4px; background: var(--wash); border-radius: var(--radius-xs); }
  .bar i {
    display: block;
    height: 4px;
    background: var(--accent);
    border-radius: var(--radius-xs);
    transition: width 200ms;
  }
  .bar i.hot { background: var(--err); }
  .subhdr { padding: 4px 14px 2px; }
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
