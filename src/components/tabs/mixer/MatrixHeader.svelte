<script lang="ts">
  import { type MatrixColumn, type OutputSlot, Mix, splitLR } from '@/domain';
  import {
    setOutputDelay,
    setOutputGain,
    setOutputEnabled,
    setOutputMuted,
  } from '@/runtime';
  import ValueField from '@/components/chrome/ValueField.svelte';
  import { chKey } from '@/styles/palette';
  import { getSession } from '@/components/sessionContext';

  const {
    column,
    outputIndex,
    zebra,
    unavailable = false,
    selected = false,
  }: {
    column: MatrixColumn;
    outputIndex: OutputSlot;
    zebra: boolean;
    unavailable?: boolean;
    selected?: boolean;
  } = $props();

  const s = getSession();

  const parts = $derived(splitLR(column.name));

  function onPower(): void {
    setOutputEnabled(s, outputIndex, !column.enabled);
  }
  function onMute(): void {
    setOutputMuted(s, outputIndex, !column.muted);
  }
</script>

<div
  class="header ch-{chKey(column.id)}"
  class:zebra
  class:unavailable
  class:selected
  title={unavailable ? 'unavailable while PDM subwoofer is active' : undefined}
>
  <div class="icons">
    <button
      type="button"
      class="mute"
      class:on={column.muted}
      onclick={onMute}
      title="toggle mute"
    >
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
        <path d="M3 6 H 5.5 L 8.5 3.5 V 12.5 L 5.5 10 H 3 Z" fill="currentColor" />
        {#if column.muted}
          <path d="M11 5 L 14 8 M 14 5 L 11 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        {:else}
          <path d="M10.5 5.5 Q 12 8 10.5 10.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" fill="none" />
          <path d="M11.8 4 Q 14 8 11.8 12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" fill="none" opacity="0.55" />
        {/if}
      </svg>
    </button>
    <button
      type="button"
      class="power"
      class:on={column.enabled}
      onclick={onPower}
      title="toggle output enable"
    >
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
        <path d="M8 2.5 V 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        <path d="M5.2 4.4 A 5 5 0 1 0 10.8 4.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none" />
      </svg>
    </button>
  </div>

  <div class="ident">
    <span class="cid">{column.shortName}</span>
    {#if parts.side}<span class="side">{parts.side}</span>{/if}
  </div>
  <div class="basename" title={parts.base}>{parts.base}</div>

  <div class="field">
    <span class="label">GAIN</span>
    <ValueField
      kind="dB-signed"
      tone="signed"
      min={Mix.OUTPUT_GAIN_MIN_DB}
      max={Mix.OUTPUT_GAIN_MAX_DB}
      align="center"
      value={column.gainDb}
      disabled={!column.enabled}
      onChange={(v) => setOutputGain(s, outputIndex, v)}
    />
  </div>
  <div class="field">
    <span class="label">DELAY</span>
    <ValueField
      kind="ms"
      min={Mix.OUTPUT_DELAY_MIN_MS}
      max={Mix.OUTPUT_DELAY_MAX_MS}
      align="center"
      value={column.delayMs}
      disabled={!column.enabled}
      onChange={(v) => setOutputDelay(s, outputIndex, v)}
    />
  </div>
</div>

<style>
  .header {
    padding: 8px 10px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-family: var(--font-mono);
    position: relative;
    background: var(--wash-faint);
    transition: opacity 120ms;
  }
  .header.zebra { background: var(--wash); }
  /* U-P3 policy B: no whole-header dim when the output is off. Channel code,
     name, and mute/power buttons stay full-contrast; GAIN/DELAY ValueFields
     below are disabled in that state and carry the single dim layer alone. */
  /* Selected-channel locator: a channel-color line over the column, echoing
     the rail's L/R group spine (ChannelRail .spine) and MixerTab's row-head
     mate (var(--ch-base) bar). An absolutely-positioned strip so the matrix
     grid never reflows. */
  .header.selected::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    border-radius: 2px;
    background: var(--ch-base);
    opacity: 0.85;
    pointer-events: none;
  }
  /* PDM exclusivity: same hatched-grey treatment as the cells in this
     column, so the whole column reads as one locked-out band. */
  .header.unavailable {
    color: var(--text-faint);
    background:
      repeating-linear-gradient(
        135deg,
        var(--wash-strong) 0 2px,
        transparent 2px 6px
      ),
      var(--wash-faint);
  }
  .header.unavailable button { cursor: not-allowed; }

  .icons {
    position: absolute;
    top: 6px;
    right: 6px;
    display: flex;
    gap: 2px;
  }
  .power, .mute {
    width: 18px;
    height: 18px;
    border-radius: var(--radius-s);
    padding: 0;
    background: transparent;
    border: 1px solid var(--border-hi);
    color: var(--text-faint);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 120ms, border-color 120ms, color 120ms;
  }
  .power.on {
    background: color-mix(in oklab, var(--accent) 15%, transparent);
    border-color: var(--accent);
    color: var(--accent);
  }
  .mute.on {
    background: color-mix(in oklab, var(--err) 20%, transparent);
    border-color: var(--err);
    color: color-mix(in oklab, var(--err), white 25%);
  }

  .ident {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding-right: 46px; /* room for icon group */
  }
  .cid {
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
  .basename {
    font-size: 10px;
    color: var(--text-dim);
    font-family: var(--font-sans);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-height: 16px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .label {
    font-size: 8px;
    color: var(--text-faint);
    letter-spacing: 1px;
  }
</style>
