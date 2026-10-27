<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import KV from '@/components/chrome/KV.svelte';
  import { chKey } from '@/styles/palette';
  import { clearClips } from '@/runtime';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const snap = $derived(s.mirror.current);
  const info = $derived(s.telemetry.info);

  function fmtNum(v: number | null | undefined): string { return v == null ? '—' : String(v); }
  function isNonZero(v: number | null | undefined): boolean { return v != null && v > 0; }
</script>

<Panel title="ERROR COUNTERS">
  {#snippet right()}
    <button class="chip" onclick={() => clearClips(s)} title="Clear latched clip flags">CLEAR</button>
  {/snippet}
  <div class="kvgrid">
    <KV label="PDM RING OVR" value={fmtNum(info?.pdmRingOverruns)}       tone={isNonZero(info?.pdmRingOverruns)       ? undefined : 'off'} />
    <KV label="PDM RING UNR" value={fmtNum(info?.pdmRingUnderruns)}      tone={isNonZero(info?.pdmRingUnderruns)      ? undefined : 'off'} />
    <KV label="PDM DMA OVR"  value={fmtNum(info?.pdmDmaOverruns)}        tone={isNonZero(info?.pdmDmaOverruns)        ? undefined : 'off'} />
    <KV label="PDM DMA UNR"  value={fmtNum(info?.pdmDmaUnderruns)}       tone={isNonZero(info?.pdmDmaUnderruns)       ? undefined : 'off'} />
    <KV label="SPDIF OVR"    value={fmtNum(info?.spdifOverruns)}         tone={isNonZero(info?.spdifOverruns)         ? undefined : 'off'} />
    <KV label="SPDIF UNR"    value={fmtNum(info?.spdifUnderruns)}        tone={isNonZero(info?.spdifUnderruns)        ? undefined : 'off'} />
    <KV label="SPDIF STARV"  value={fmtNum(info?.spdifStarvationsTotal)} tone={isNonZero(info?.spdifStarvationsTotal) ? undefined : 'off'} />
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
  .clipgrid { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 14px 14px; }
  .clipsq {
    min-width: 28px;
    padding: 3px 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.5px;
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
