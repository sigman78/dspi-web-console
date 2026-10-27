<script lang="ts">
  import ValueField from '@/components/chrome/ValueField.svelte';
  import type { ValueKind } from '@/components/chrome/valueFieldFormat';

  const {
    label,
    ariaLabel,
    value,
    min,
    max,
    step,
    kind,
    precision,
    floorLabel,
    ceilLabel,
    disabled = false,
    reset,
    onChange,
  }: {
    label: string;
    ariaLabel: string;
    value: number;
    min: number;
    max: number;
    step: number;
    kind: ValueKind;
    precision?: number;
    floorLabel?: string;
    ceilLabel?: string;
    disabled?: boolean;
    /** Adds a chip that writes `value` back; disabled while already there. */
    reset?: { value: number; label: string };
    onChange: (v: number) => void;
  } = $props();

  function onInput(e: Event): void {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (!Number.isNaN(v)) onChange(v);
  }
</script>

<div class="prow">
  <span class="prow-lbl" title={label}>{label}</span>
  <input type="range" {min} {max} {step} {value} {disabled} aria-label={ariaLabel} oninput={onInput} />
  <span class="prow-fld">
    <ValueField {value} {min} {max} {step} {kind} {precision} {floorLabel} {ceilLabel} {disabled} {onChange} />
  </span>
  {#if reset}
    <button type="button" class="chip hi" aria-label={`Reset ${label} to ${reset.label}`} disabled={disabled || value === reset.value}
      onclick={() => onChange(reset.value)}>{reset.label}</button>
  {/if}
</div>

<style>
  input[type='range'] { flex: 0 0 auto; width: var(--rf-track, 140px); margin: 0; accent-color: var(--accent); }
  input[type='range']:disabled { opacity: var(--dim-disabled); cursor: default; }
</style>
