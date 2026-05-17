<script lang="ts">
  import Panel from '../chrome/Panel.svelte';
  import MatrixHeader from './mixer/MatrixHeader.svelte';
  import MatrixCell from './mixer/MatrixCell.svelte';
  import { matrixColumns, matrixRows } from '../../domain';
  import { dsp } from '../../state';
  import { chKey } from '../../styles/palette';

  const columns = $derived(matrixColumns(dsp.live));
  const rows = $derived(matrixRows(dsp.live));

  // PDM-exclusivity hint. Per docs/mixer.md: when PDM (the last output)
  // is enabled, only outputs 0,1 (S/PDIF 1) and the PDM index itself are
  // available. We don't enforce this client-side -- firmware is the source
  // of truth -- we just dim the unavailable columns so the user understands
  // why a write may not stick.
  const pdmIndex = $derived(dsp.live?.platform.pdmOutputIndex ?? -1);
  const pdmActive = $derived(pdmIndex >= 0 && (columns[pdmIndex]?.enabled ?? false));
  function isUnavailable(outputIndex: number): boolean {
    if (!pdmActive) return false;
    return outputIndex !== 0 && outputIndex !== 1 && outputIndex !== pdmIndex;
  }

  function splitLR(name: string): { base: string; side: string | null } {
    const m = name.match(/^(.+?)\s+([LR])$/);
    return m ? { base: m[1], side: m[2] } : { base: name, side: null };
  }

  const cols = $derived(`96px repeat(${columns.length}, 128px)`);
</script>

<Panel code="MX.01" title="ROUTING MATRIX">
  {#snippet right()}
    <span class="meta">click cell to enable · click ⌽ for phase invert · click power/mute per output</span>
  {/snippet}

  {#if !dsp.live}
    <p class="empty">No platform info loaded yet.</p>
  {:else}
    <div class="wrap">
      <div class="matrix" style="grid-template-columns: {cols};">
        <!-- Header row: corner + one MatrixHeader per output -->
        <div class="corner">IN ╲ OUT</div>
        {#each columns as col, i (col.wireIdx)}
          <MatrixHeader
            column={col}
            outputIndex={col.wireIdx}
            zebra={i % 2 === 0}
            unavailable={isUnavailable(i)}
          />
        {/each}

        <!-- Body: one row per input -->
        {#each rows as row (row.inputIndex)}
          {@const parts = splitLR(row.label)}
          <div class="row-head ch-{chKey(row.inputId)}">
            <div class="ident">
              <span class="rid">IN{row.inputIndex + 1}</span>
              {#if parts.side}<span class="side">{parts.side}</span>{/if}
            </div>
            <div class="rname">{parts.base}</div>
          </div>
          {#each row.cells as cell, ci (cell.outputWireIndex)}
            <div class="cell-wrap" class:zebra={ci % 2 === 0}>
              <MatrixCell
                {cell}
                inputIndex={row.inputIndex}
                outputIndex={cell.outputWireIndex}
                inputChannelId={row.inputId}
                outputDisabled={!columns[ci]?.enabled}
                unavailable={isUnavailable(ci)}
              />
            </div>
          {/each}
        {/each}
      </div>
    </div>
  {/if}
</Panel>

<style>
  .meta {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-faint);
    letter-spacing: 1px;
  }
  .empty {
    padding: 16px;
    color: var(--text-dim);
  }
  .wrap {
    padding: 14px;
    overflow: auto;
  }
  .matrix {
    display: grid;
    align-items: stretch;
    min-width: max-content;
  }

  .corner {
    border-right: 1px solid color-mix(in oklab, var(--text) 10%, transparent);
    border-bottom: 1px solid color-mix(in oklab, var(--text) 10%, transparent);
    background: color-mix(in oklab, var(--text) 1.5%, transparent);
    display: flex;
    align-items: flex-end;
    padding: 6px 10px 8px;
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-faint);
    letter-spacing: 1px;
  }

  .matrix > :global(.header) {
    border-bottom: 1px solid color-mix(in oklab, var(--text) 10%, transparent);
  }

  .row-head {
    padding: 10px 10px;
    border-right: 1px solid color-mix(in oklab, var(--text) 10%, transparent);
    background: color-mix(in oklab, var(--text) 1.5%, transparent);
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-family: var(--font-mono);
    justify-content: center;
  }
  .ident {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .rid {
    font-size: 10px;
    font-weight: 700;
    color: var(--ch-bright);
  }
  .side {
    font-size: 9px;
    color: var(--text-faint);
    font-weight: 600;
    letter-spacing: 0.5px;
  }
  .rname {
    font-size: 11px;
    color: var(--text);
    font-family: var(--font-sans);
  }

  .cell-wrap {
    background: color-mix(in oklab, var(--text) 1.5%, transparent);
  }
  .cell-wrap.zebra {
    background: color-mix(in oklab, var(--text) 5%, transparent);
  }
</style>
