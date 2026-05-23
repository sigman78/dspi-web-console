<script lang="ts">
  import { type MatrixColumn, type OutputSlot, Mix } from '@/domain';
  import {
    setOutputDelay,
    setOutputGain,
    setOutputEnabled,
    setOutputMuted,
  } from '@/runtime';
  import ValueField from '../../chrome/ValueField.svelte';
  import { chKey } from '@/styles/palette';

  const {
    column,
    outputIndex,
    zebra,
    unavailable = false,
  }: {
    column: MatrixColumn;
    outputIndex: OutputSlot;
    zebra: boolean;
    unavailable?: boolean;
  } = $props();

  // Split a channel display name into base + L/R suffix, mirroring the JSX.
  function splitLR(name: string): { base: string; side: string | null } {
    const m = name.match(/^(.+?)\s+([LR])$/);
    return m ? { base: m[1], side: m[2] } : { base: name, side: null };
  }
  const parts = $derived(splitLR(column.name));

  function onPower(): void {
    setOutputEnabled(outputIndex, !column.enabled);
  }
  function onMute(): void {
    setOutputMuted(outputIndex, !column.muted);
  }
</script>

<div
  class="header ch-{chKey(column.id)}"
  class:dim={!column.enabled}
  class:zebra
  class:unavailable
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
      size="md"
      align="center"
      value={column.gainDb}
      disabled={!column.enabled}
      onChange={(v) => setOutputGain(outputIndex, v)}
    />
  </div>
  <div class="field">
    <span class="label">DELAY</span>
    <ValueField
      kind="ms"
      min={Mix.OUTPUT_DELAY_MIN_MS}
      max={Mix.OUTPUT_DELAY_MAX_MS}
      size="md"
      align="center"
      value={column.delayMs}
      disabled={!column.enabled}
      onChange={(v) => setOutputDelay(outputIndex, v)}
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
    background: color-mix(in oklab, var(--text) 1.5%, transparent);
    transition: opacity 120ms;
  }
  .header.zebra { background: color-mix(in oklab, var(--text) 5%, transparent); }
  .header.dim { opacity: 0.5; }
  /* PDM exclusivity: same hatched-grey treatment as the cells in this
     column, so the whole column reads as one locked-out band. */
  .header.unavailable {
    color: var(--text-faint);
    background:
      repeating-linear-gradient(
        135deg,
        color-mix(in oklab, var(--text) 8%, transparent) 0 2px,
        transparent 2px 6px
      ),
      color-mix(in oklab, var(--text) 2%, transparent);
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
    border-radius: 3px;
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
