<script lang="ts">
  // VALUE and STEP SIZE controls for a (noun, action) pair. Renders
  // label/control pairs for the caller's `.row`; values are in display units.
  import { defaultUnitFor, type ValueKind } from '@/components/chrome/valueFieldFormat';
  import * as Domain from '@/domain';
  import NumField from '@/components/chrome/NumField.svelte';
  import * as CsUnit from '@/domain/cs/unitDisplay';
  import * as CsField from '@/domain/cs/fieldHelpers';
  import { unitField } from './csFieldFormat';

  const { nouns, noun, action, steppy, presetNames, macros, displayPages, value, step, disabled = false, ariaSuffix = '', onValue, onStep }: {
    nouns: readonly Domain.CsNounCaps[];
    noun: number;
    action: number;
    steppy: readonly number[];
    presetNames: readonly (string | null)[];
    macros: readonly (Domain.CsMacro | null)[];
    displayPages: readonly (Domain.CsDisplayPage | null)[];
    value: number;
    step: number;
    disabled?: boolean;
    ariaSuffix?: string;
    onValue: (v: number) => void;
    onStep: (v: number) => void;
  } = $props();

  const cont = $derived(CsField.contOf(nouns, noun));
  const isEnum = $derived(CsField.enumOf(nouns, noun));
  const unit = $derived(CsField.unitOf(nouns, noun));
  const label = $derived(CsField.valueLabel(action, cont, noun));
  const accessibleLabel = $derived(label.charAt(0) + label.slice(1).toLowerCase());
  const valueField = $derived(unitField(unit));
  const bounds = $derived(CsField.valueBounds(nouns, noun));
  const valueSuffix = $derived(CsUnit.unitSuffix(unit));
  const valueOptions = $derived(
    isEnum
      ? CsField.enumValueOptions(nouns, noun, presetNames, macros, displayPages)
      : CsField.boolValueOptions(noun),
  );

  // Kinds that print their own unit need no trailing hint.
  function hintFor(kind: ValueKind, suffix: string): string | undefined {
    return defaultUnitFor(kind) === '' && suffix ? suffix : undefined;
  }

  // Log-stepped units (Hz, Q) step in octaves; the rest in their own unit.
  const stepField = $derived.by(() => {
    if (isEnum) {
      return {
        kind: 'int' as ValueKind, step: 1, precision: 0, min: 1,
        max: Math.max(1, (nouns[noun]?.enumCount ?? 2) - 1), hint: undefined as string | undefined,
        label: 'Step size (positions)',
      };
    }
    if (CsUnit.isLogStep(unit)) {
      return {
        kind: 'q' as ValueKind, step: 0.01, precision: 2, min: 0,
        max: Domain.q8StepToOctaves(0x7FFF), hint: CsUnit.stepUnitSuffix(unit), label: 'Step size (octaves)',
      };
    }
    const suffix = CsUnit.stepUnitSuffix(unit);
    return {
      ...valueField, min: 0, max: Math.max(valueField.step, CsUnit.valueToDisplay(unit, 0x7FFF)),
      hint: hintFor(valueField.kind, suffix), label: `Step size (${suffix})`,
    };
  });
</script>

{#if CsField.showValueOf(action)}
  <span class="pair">
    <span class="microlbl">{label}</span>
    {#if cont}
      <NumField {value} min={bounds.min} max={bounds.max} step={valueField.step}
        kind={valueField.kind} precision={valueField.precision} {disabled}
        ariaLabel={`${accessibleLabel} (${valueSuffix})${ariaSuffix}`}
        hint={hintFor(valueField.kind, valueSuffix)}
        onChange={onValue} />
    {:else}
      <select class="sel" value={String(value)} aria-label={`${accessibleLabel}${ariaSuffix}`} {disabled}
        onchange={(e) => onValue(Number((e.currentTarget as HTMLSelectElement).value))}>
        {#each valueOptions as o (o.v)}
          <option value={String(o.v)}>{o.label}</option>
        {/each}
      </select>
    {/if}
  </span>
{/if}
{#if CsField.showStepOf(action, steppy)}
  <span class="pair">
    <span class="microlbl">STEP SIZE</span>
    <NumField value={step} min={stepField.min} max={stepField.max} step={stepField.step}
      kind={stepField.kind} precision={stepField.precision} {disabled}
      ariaLabel={`${stepField.label}${ariaSuffix}`} hint={stepField.hint} onChange={onStep} />
  </span>
{/if}

<style>
  .pair { display: inline-flex; align-items: center; gap: 8px; }
</style>
