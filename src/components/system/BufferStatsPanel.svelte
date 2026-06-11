<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import KV from '@/components/chrome/KV.svelte';
  import { connection } from '@/state';
  import { resetBufferStats } from '@/runtime';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const connected = $derived(connection.connected);
  const bs = $derived(s.telemetry.bufferStats);

  function pct(v: number | undefined): string {
    return v != null ? `${v}%` : '—';
  }
</script>

<Panel code="SY.08" title="BUFFER STATS">
  {#snippet right()}
    <button
      class="reset-btn"
      onclick={() => resetBufferStats(s)}
      disabled={!connected}
      title="Zero all buffer-stats counters on the device"
    >RESET</button>
  {/snippet}

  {#if bs}
    <div class="kvgrid">
      <KV label="SEQUENCE"    value={String(bs.sequence)} />
      <KV label="STREAMING"   value={bs.streaming ? 'YES' : 'NO'} tone={bs.streaming ? 'ok' : 'off'} />
      <KV label="PDM ACTIVE"  value={bs.pdmActive ? 'YES' : 'NO'} tone={bs.pdmActive ? 'ok' : 'off'} />
      <KV label="SPDIF SLOTS" value={String(bs.numSpdif)} />
    </div>

    {#each bs.spdif.slice(0, bs.numSpdif) as slot, i (i)}
      <div class="subhdr">SPDIF {i + 1}</div>
      <div class="kvgrid">
        <KV label="FREE"    value={String(slot.consumerFree)} />
        <KV label="PREP"    value={String(slot.consumerPrepared)} />
        <KV label="PLAY"    value={String(slot.consumerPlaying)} />
        <KV label="FILL"    value={pct(slot.consumerFillPct)} />
        <KV label="MIN"     value={pct(slot.consumerMinFillPct)} />
        <KV label="MAX"     value={pct(slot.consumerMaxFillPct)} />
      </div>
    {/each}

    <div class="subhdr">PDM DMA / RING</div>
    <div class="kvgrid">
      <KV label="DMA FILL"  value={pct(bs.pdm.dmaFillPct)} />
      <KV label="DMA MIN"   value={pct(bs.pdm.dmaMinFillPct)} />
      <KV label="DMA MAX"   value={pct(bs.pdm.dmaMaxFillPct)} />
      <KV label="RING FILL" value={pct(bs.pdm.ringFillPct)} />
      <KV label="RING MIN"  value={pct(bs.pdm.ringMinFillPct)} />
      <KV label="RING MAX"  value={pct(bs.pdm.ringMaxFillPct)} />
    </div>
  {:else}
    <p class="idle">Waiting for buffer stats…</p>
  {/if}
</Panel>

<style>
  .kvgrid { padding: 10px 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .subhdr {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1.5px;
    color: var(--text-faint);
    padding: 6px 14px 0;
    border-top: 1px solid color-mix(in oklab, var(--text) 4%, transparent);
    margin-top: 2px;
  }
  .reset-btn {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1px;
    padding: 2px 8px;
    border-radius: 3px;
    background: color-mix(in oklab, var(--text) 4%, transparent);
    border: 1px solid var(--border);
    color: var(--text-dim);
    cursor: pointer;
  }
  .reset-btn:hover:not(:disabled) { color: var(--text); border-color: var(--border-hi); }
  .reset-btn:disabled { opacity: 0.45; cursor: default; }
  .idle { font-family: var(--font-mono); font-size: 9px; color: var(--text-faint); padding: 12px 14px; margin: 0; }
</style>
