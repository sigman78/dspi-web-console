<script lang="ts">
  import ValueField from '@/components/chrome/ValueField.svelte';
  import type { ValueKind } from '@/components/chrome/valueFieldFormat';

  const { value, min, max, step, kind, precision, disabled = false, ariaLabel, title, hint, onChange }: {
    value: number;
    min: number;
    max: number;
    step: number;
    kind: ValueKind;
    precision?: number;
    disabled?: boolean;
    ariaLabel: string;
    title?: string;
    // Trailing unit text for kinds that do not print their own.
    hint?: string;
    onChange: (v: number) => void;
  } = $props();
</script>

<span class="nf" {title}>
  <span class="fld">
    <ValueField {value} {min} {max} {step} {kind} {precision} {disabled} {ariaLabel} align="right" {onChange} />
  </span>
  {#if hint}<span class="hint">{hint}</span>{/if}
</span>

<style>
  .nf { display: inline-flex; align-items: center; gap: 6px; }
  .fld { display: block; width: 72px; flex: none; }
</style>
