<script lang="ts">
  import type { PinCandidate } from '@/domain';
  import { Wire } from '@/protocol';

  // allowReset: caller passed capabilities.features.pinResetDefault AND this
  // target supports the reset semantics (see PINS-CONFIG.md / the pin-reset
  // escape hatch). Renders a synthetic DEFAULT entry ahead of the GPIO list;
  // picking it emits Wire.Const.PIN_RESET_TO_DEFAULT like any other pin value.
  const { value, candidates, disabled = false, allowReset = false, resetLabel = 'DEFAULT', placeholder, ariaLabel, onChange }: {
    value: number;
    candidates: PinCandidate[];
    disabled?: boolean;
    allowReset?: boolean;
    resetLabel?: string;
    placeholder?: string;
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
  {#if placeholder}
    <option value="0" disabled>{placeholder}</option>
  {/if}
  {#if allowReset}
    <option value={String(Wire.Const.PIN_RESET_TO_DEFAULT)}>{resetLabel}</option>
  {/if}
  {#each candidates as c (c.pin)}
    <option
      value={String(c.pin)}
      disabled={c.usedBy !== null}
      class={c.usedBy !== null && c.role ? `pinrole-${c.role}` : ''}
      style={c.usedBy !== null && c.role ? 'color: var(--role-base)' : ''}
    >
      GP{c.pin}{c.usedBy ? ` · ${c.usedBy}` : (c.adc ? ' · ADC' : '')}
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
