<script lang="ts">
  // A labeled range + ValueField pair for one row of a processing panel's
  // 3-col grid (label / slider / numeric readout). No wrapper element --
  // Svelte templates allow multiple top-level nodes, so the three cells
  // land directly in the caller's `.grid` exactly as if hand-written there.
  import ValueField from './ValueField.svelte';
  import type { ValueKind } from './valueFieldFormat';

  const {
    label,
    ariaLabel,
    value,
    min,
    max,
    step,
    kind,
    precision,
    disabled = false,
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
    disabled?: boolean;
    onChange: (v: number) => void;
  } = $props();

  function onRangeInput(e: Event): void {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (!Number.isNaN(v)) onChange(v);
  }
</script>

<span class="microlbl">{label}</span>
<input
  type="range"
  {min}
  {max}
  {step}
  {value}
  oninput={onRangeInput}
  {disabled}
  aria-label={ariaLabel}
/>
<ValueField
  {value}
  {min}
  {max}
  {step}
  {kind}
  {precision}
  {disabled}
  {onChange}
/>

<style>
  input[type="range"] { accent-color: var(--accent); margin: 0; }
  input[type="range"]:disabled { opacity: 0.4; cursor: default; }
</style>
