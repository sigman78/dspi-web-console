<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
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

<Panel code="SY.12" title="BUFFER STATS">
  {#snippet right()}
    {#if bs}
      <span class="seq">SEQ {bs.sequence}</span>
    {/if}
    <button
      class="reset-btn"
      onclick={() => resetBufferStats(s)}
      disabled={!connected}
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
              <td>{pct(slot.consumerFillPct)}</td>
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
    <p class="idle">Waiting for buffer stats…</p>
  {/if}
</Panel>

<style>
  .tblwrap { padding: 8px 14px 12px; overflow-x: auto; }
  .tbl {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-mono);
    font-size: 9px;
  }
  .tbl thead th {
    color: var(--text-faint);
    font-weight: 700;
    letter-spacing: 1.5px;
    text-align: right;
    padding: 2px 6px;
    border-bottom: 1px solid color-mix(in oklab, var(--text) 4%, transparent);
  }
  .tbl thead th.src { text-align: left; }
  .tbl tbody td {
    color: var(--text-dim);
    text-align: right;
    padding: 3px 6px;
    border-bottom: 1px solid color-mix(in oklab, var(--text) 4%, transparent);
  }
  .tbl tbody td.src { color: var(--text-faint); text-align: left; letter-spacing: 0.5px; }
  .tbl tbody tr:last-child td { border-bottom: none; }

  .seq {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-faint);
    letter-spacing: 0.5px;
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
