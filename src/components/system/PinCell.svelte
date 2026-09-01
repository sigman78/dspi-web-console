<script lang="ts">
  import type { PinUse } from '@/domain';

  // Shared visual for a single GPIO cell -- the PIN MAP grid (interactive:
  // false, a plain div) and the PinPicker popup grid (interactive: true, a
  // selectable button) render the exact same look from the same markup.
  const {
    pin,
    use,
    reserved,
    adc,
    selected = false,
    selectable = true,
    interactive = false,
    title,
    onSelect,
  }: {
    pin: number;
    use: PinUse | null;
    reserved: boolean;
    adc: boolean;
    selected?: boolean;
    selectable?: boolean;
    interactive?: boolean;
    title: string;
    onSelect?: () => void;
  } = $props();

  const roleClass = $derived(use ? `pinrole-${use.role}` : '');
  // Blocked: not reserved, not taken, but still not pickable for this target
  // (BCK adjacency, ADC-only, etc). Dimmed like a reserved cell, no hatch.
  const blocked = $derived(!selectable && !use && !reserved);
</script>

{#if interactive}
  <button
    type="button"
    class="cell {roleClass}"
    class:used={!!use}
    class:reserved
    class:blocked
    class:selected
    disabled={!selectable}
    role="option"
    aria-selected={selected}
    {title}
    onclick={() => onSelect?.()}
  >
    {#if adc}<span class="adc-mark">▪</span>{/if}
    <span class="num">GP{pin}</span>
  </button>
{:else}
  <div class="cell {roleClass}" class:used={!!use} class:reserved {title}>
    {#if adc}<span class="adc-mark">▪</span>{/if}
    <span class="num">GP{pin}</span>
  </div>
{/if}

<style>
  .cell {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px 2px;
    border-radius: var(--radius-s);
    border: 1px solid var(--border);
    background: var(--wash);
    color: var(--text-faint);
    overflow: hidden;
    font: inherit;
    margin: 0;
  }
  button.cell { cursor: pointer; }
  button.cell:disabled { cursor: default; }
  button.cell:hover:not(:disabled) {
    border-color: var(--border-hi);
    background: var(--wash-strong);
    color: var(--text);
  }
  button.cell.used:hover:not(:disabled) {
    background: color-mix(in oklab, var(--role-base) 28%, transparent);
    border-color: var(--role-base);
    color: var(--role-base);
  }
  .cell.used {
    background: color-mix(in oklab, var(--role-base) 14%, transparent);
    border-color: color-mix(in oklab, var(--role-base) 45%, transparent);
    color: var(--role-base);
  }
  .cell.reserved {
    background: repeating-linear-gradient(45deg, transparent 0 3px, var(--wash-strong) 3px 4px);
  }
  .cell.reserved .num,
  .cell.blocked .num { opacity: var(--dim-disabled); }
  .cell.selected { outline: 1px solid var(--accent); outline-offset: -1px; }
  .num {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.3px;
  }
  .adc-mark {
    position: absolute;
    top: 1px;
    right: 2px;
    font-size: 8px;
    line-height: 1;
    color: var(--warn);
  }
</style>
