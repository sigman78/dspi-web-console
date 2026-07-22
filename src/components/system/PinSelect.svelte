<script lang="ts">
  import type { PinCandidate } from '@/domain';
  import { Wire } from '@/protocol';

  // allowReset: caller passed capabilities.features.pinResetDefault AND this
  // target supports the reset semantics (see PINS-CONFIG.md / the pin-reset
  // escape hatch). Renders a synthetic DEFAULT entry ahead of the GPIO list;
  // picking it emits Wire.Const.PIN_RESET_TO_DEFAULT like any other pin value.
  const { value, candidates, disabled = false, allowReset = false, ariaLabel, onChange }: {
    value: number;
    candidates: PinCandidate[];
    disabled?: boolean;
    allowReset?: boolean;
    ariaLabel: string;
    onChange: (pin: number) => void;
  } = $props();
</script>

<select
  class="pinsel"
  {disabled}
  aria-label={ariaLabel}
  value={String(value)}
  onchange={(e) => onChange(Number((e.currentTarget as HTMLSelectElement).value))}
>
  {#if allowReset}
    <option value={String(Wire.Const.PIN_RESET_TO_DEFAULT)}>DEFAULT</option>
  {/if}
  {#each candidates as c (c.pin)}
    <option value={String(c.pin)} disabled={c.usedBy !== null}>
      GP{c.pin}{c.usedBy ? ` · ${c.usedBy}` : ''}
    </option>
  {/each}
</select>

<style>
  .pinsel {
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 3px 6px;
    background: var(--panel-solid);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
  }
  .pinsel:disabled { opacity: var(--dim-disabled); cursor: default; }
</style>
