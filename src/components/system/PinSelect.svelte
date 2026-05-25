<script lang="ts">
  import type { PinCandidate } from '@/domain';

  const { value, candidates, disabled = false, ariaLabel, onChange }: {
    value: number;
    candidates: PinCandidate[];
    disabled?: boolean;
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
  .pinsel:disabled { opacity: 0.4; cursor: default; }
</style>
