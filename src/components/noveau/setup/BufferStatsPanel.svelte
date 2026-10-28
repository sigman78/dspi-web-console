<script lang="ts">
  import { untrack } from 'svelte';
  import Panel from '@/components/chrome/Panel.svelte';
  import { resetBufferStats } from '@/runtime';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const bs = $derived(s.telemetry.bufferStats);

  $effect(() => untrack(() => s.telemetry.wantBufferStats()));

  function pct(v: number | undefined): string {
    return v != null ? `${v}%` : '—';
  }

  // Sample-granular fill in 0.01% units; reads 0 on firmware without the
  // field, where the coarse 16-bucket pct is all we have.
  function fill(slot: { fillCentiPct: number; consumerFillPct: number }): string {
    return slot.fillCentiPct > 0 ? `${(slot.fillCentiPct / 100).toFixed(2)}%` : pct(slot.consumerFillPct);
  }
</script>

<Panel title="BUFFER STATS">
  {#snippet right()}
    {#if bs}
      <span class="seq">SEQ {bs.sequence}</span>
    {/if}
    <button
      class="chip"
      onclick={() => resetBufferStats(s)}
      title="Zero all buffer-stats counters on the device"
    >RESET</button>
  {/snippet}

  {#if bs}
    <div class="tblwrap">
      <table class="tbl">
        <thead>
          <tr>
            <th class="src">SRC</th>
            <th>FILL</th>
            <th>MIN</th>
            <th>MAX</th>
            <th>FREE</th>
            <th>PREP</th>
            <th>PLAY</th>
          </tr>
        </thead>
        <tbody>
          {#each bs.spdif.slice(0, bs.numSpdif) as slot, i (i)}
            <tr>
              <td class="src">SPDIF {i + 1}</td>
              <td>{fill(slot)}</td>
              <td>{pct(slot.consumerMinFillPct)}</td>
              <td>{pct(slot.consumerMaxFillPct)}</td>
              <td>{slot.consumerFree}</td>
              <td>{slot.consumerPrepared}</td>
              <td>{slot.consumerPlaying}</td>
            </tr>
          {/each}
          <tr>
            <td class="src">PDM DMA</td>
            <td>{pct(bs.pdm.dmaFillPct)}</td>
            <td>{pct(bs.pdm.dmaMinFillPct)}</td>
            <td>{pct(bs.pdm.dmaMaxFillPct)}</td>
            <td>—</td>
            <td>—</td>
            <td>—</td>
          </tr>
          <tr>
            <td class="src">PDM RING</td>
            <td>{pct(bs.pdm.ringFillPct)}</td>
            <td>{pct(bs.pdm.ringMinFillPct)}</td>
            <td>{pct(bs.pdm.ringMaxFillPct)}</td>
            <td>—</td>
            <td>—</td>
            <td>—</td>
          </tr>
        </tbody>
      </table>
    </div>
  {:else}
    <p class="hint idle">Waiting for buffer stats…</p>
  {/if}
</Panel>

<style>
  .tblwrap { padding: 10px 14px 14px; }
  /* Typography mirrors KV: sans dim labels (header + SRC), mono 12px/600 values. */
  .tbl {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
    font-family: var(--font-mono);
    font-size: 9px;
  }
  .tbl thead th {
    font-family: var(--font-sans);
    font-size: var(--fs-m);
    color: var(--text-dim);
    font-weight: 400;
    text-align: right;
    padding: 2px 6px 4px;
    border-bottom: 1px solid var(--wash);
  }
  .tbl thead th.src { text-align: left; width: 64px; }
  .tbl td.src, .tbl th.src { white-space: nowrap; }
  .tbl tbody td {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
    text-align: right;
    padding: 6px;
    border-bottom: 1px solid var(--wash);
  }
  .tbl tbody td.src {
    font-family: var(--font-sans);
    font-size: var(--fs-m);
    font-weight: 400;
    color: var(--text-dim);
    text-align: left;
  }
  .tbl tbody tr:last-child td { border-bottom: none; }

  .seq {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-faint);
    letter-spacing: 0.5px;
  }
  .idle { padding: 10px 14px; }
</style>
