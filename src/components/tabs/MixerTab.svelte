<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import MatrixHeader from '@/components/tabs/mixer/MatrixHeader.svelte';
  import MatrixCell from '@/components/tabs/mixer/MatrixCell.svelte';
  import { matrixColumns, matrixRows, splitLR } from '@/domain';
  import { getSession } from '@/components/sessionContext';
  import { settings } from '@/state';
  import { chKey } from '@/styles/palette';

  const s = getSession();

  // Upmix repurposes the idle input slots 2-4 as derived-channel busses when
  // the live input is a plain stereo pair (see matrixRows); reused here only
  // when the device actually has the feature, matching the panel's own gate.
  const upmixCtx = $derived(
    s.device.capabilities.features.upmix && s.mirror.current?.upmix
      ? { enabled: s.mirror.current.upmix.enabled, surroundMode: s.mirror.current.upmix.surroundMode }
      : null
  );

  const columns = $derived(matrixColumns(s.mirror.current));
  const rows = $derived(matrixRows(s.mirror.current, s.telemetry.activeInputChannels, upmixCtx));

  const cols = $derived(`96px repeat(${columns.length}, 128px)`);
</script>

<Panel code="MX.01" title="ROUTING MATRIX">
  {#snippet right()}
    <span class="meta">click cell to enable · click ⌽ for phase invert · click mute per output</span>
  {/snippet}

  {#if !s.mirror.current}
    <p class="empty">No platform info loaded yet.</p>
  {:else if columns.length === 0}
    <p class="empty">All outputs are disabled — enable them in SYSTEM ▸ OUTPUTS.</p>
  {:else}
    <div class="wrap">
      <div class="matrix" style="grid-template-columns: {cols};">
        <div class="corner">IN ╲ OUT</div>
        {#each columns as col, i (col.wireIdx)}
          <MatrixHeader
            column={col}
            outputIndex={col.wireIdx}
            zebra={i % 2 === 0}
            selected={settings.selectedChannel === col.id}
          />
        {/each}

        {#each rows as row (row.inputIndex)}
          {@const parts = splitLR(row.label)}
          <div class="row-head ch-{chKey(row.inputId)}" class:selected={settings.selectedChannel === row.inputId}>
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
    background: var(--wash-faint);
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
    position: relative;
    padding: 10px 10px;
    border-right: 1px solid color-mix(in oklab, var(--text) 10%, transparent);
    background: var(--wash-faint);
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
  /* Selected-channel locator: a channel-color spine on the row's leading edge,
     the horizontal mate of MatrixHeader's column line and the rail's L/R group
     spine. Absolutely positioned so the grid never reflows. */
  .row-head.selected::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 3px;
    border-radius: 2px;
    background: var(--ch-base);
    opacity: 0.85;
    pointer-events: none;
  }

  .cell-wrap {
    background: var(--wash-faint);
  }
  .cell-wrap.zebra {
    background: var(--wash);
  }
</style>
