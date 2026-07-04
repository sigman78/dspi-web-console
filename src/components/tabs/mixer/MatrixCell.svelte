<script lang="ts">
  import {
    type RouteModel,
    Mix,
    type ChannelId, type InputSlot, type OutputSlot,
  } from '@/domain';
  import {
    setCrosspointGain,
    setCrosspointEnabled,
    setCrosspointInvert,
  } from '@/runtime';
  import ValueField from '@/components/chrome/ValueField.svelte';
  import { chKey } from '@/styles/palette';
  import { getSession } from '@/components/sessionContext';

  const {
    cell,
    inputIndex,
    outputIndex,
    inputChannelId,
    unavailable = false,
  }: {
    cell: RouteModel;
    inputIndex: InputSlot;
    outputIndex: OutputSlot;
    inputChannelId: ChannelId;
    unavailable?: boolean;
  } = $props();

  const s = getSession();
  const active = $derived(cell.enabled);
  const inv = $derived(cell.invert);

  function onToggle(): void {
    setCrosspointEnabled(s, inputIndex, outputIndex, !active);
  }
  function onInv(): void {
    if (!active) return;
    setCrosspointInvert(s, inputIndex, outputIndex, !inv);
  }
</script>

<div
  class="cell ch-{chKey(inputChannelId)}"
  class:active
  class:unavailable
  title={unavailable ? 'unavailable while PDM subwoofer is active' : undefined}
>
  <button
    type="button"
    class="enable"
    onclick={onToggle}
  >
    <span class="dot" class:on={active}></span>
    <span class="state">{active ? 'ON' : 'OFF'}</span>
  </button>

  <ValueField
    kind="dB-signed"
    tone="signed"
    min={Mix.CROSSPOINT_GAIN_MIN_DB}
    max={Mix.CROSSPOINT_GAIN_MAX_DB}
    size="sm"
    align="center"
    value={cell.gainDb}
    disabled={!active}
    onChange={(v) => setCrosspointGain(s, inputIndex, outputIndex, v)}
  />

  <button
    type="button"
    class="phase"
    class:inv
    disabled={!active}
    onclick={onInv}
  >
    {#if inv}
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
        <path d="M1 8 Q 4 14 7 8 T 13 8 L 15 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none" />
      </svg>
      <span>INV</span>
    {:else}
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
        <path d="M1 8 Q 4 2 7 8 T 13 8 L 15 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none" />
      </svg>
      <span>NORM</span>
    {/if}
  </button>
</div>

<style>
  .cell {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px;
    font-family: var(--font-mono);
    transition: background 120ms, box-shadow 120ms, opacity 120ms;
    background: transparent;
  }
  .cell.active {
    background: color-mix(in oklab, var(--ch-base) 18%, transparent);
    box-shadow:
      inset 0 0 0 1px color-mix(in oklab, var(--ch-dim) 35%, transparent),
      inset 0 0 14px color-mix(in oklab, var(--ch-glow) 12%, transparent);
  }
  /* U-P3 policy B: no whole-cell dim when the output is off. The OFF label
     and cell structure stay full-contrast; the enable dot, gain field, and
     NORM/phase button below are disabled in that state and carry the
     single dim layer alone. */
  /* PDM-exclusivity hint: diagonal hatch overlay over a desaturated grey
     wash. Stronger visual signal than a plain opacity dim -- users can tell
     "this column is locked out" at a glance without confusing it with the
     normal !enabled dim. Background stacked: hatch on top, grey wash below. */
  .cell.unavailable {
    cursor: not-allowed;
    color: var(--text-faint);
    background:
      repeating-linear-gradient(
        135deg,
        var(--wash-strong) 0 2px,
        transparent 2px 6px
      ),
      var(--wash-faint);
    box-shadow: none;
  }
  .cell.unavailable button { cursor: not-allowed; }

  .enable {
    background: transparent;
    border: none;
    color: inherit;
    cursor: pointer;
    padding: 4px 0 2px;
    font-family: inherit;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .dot {
    width: 14px; height: 14px;
    border-radius: 50%;
    background: transparent;
    border: 1.5px solid var(--border-hi);
    transition: background 120ms, box-shadow 120ms, border-color 120ms;
  }
  .dot.on {
    background: var(--ch-glow);
    border: none;
    box-shadow: 0 0 10px color-mix(in oklab, var(--ch-glow) 60%, transparent);
  }
  .state {
    font-size: 9px;
    color: var(--text-faint);
    letter-spacing: 1px;
    font-weight: 600;
  }
  .cell.active .state { color: color-mix(in oklab, var(--ch-bright), white 8%); }

  .phase {
    padding: 3px 4px;
    border-radius: var(--radius-s);
    background: var(--wash);
    border: 1px solid var(--border);
    color: var(--text-faint);
    font-family: inherit;
    font-size: 9px;
    letter-spacing: 1px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
  }
  .phase[disabled] { cursor: default; opacity: var(--dim-disabled); }
  .cell.active .phase { color: var(--text-dim); }
  .phase.inv {
    background: color-mix(in oklab, var(--err) 18%, transparent);
    border-color: var(--err);
    color: color-mix(in oklab, var(--err), white 25%);
  }
</style>
