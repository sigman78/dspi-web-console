<script lang="ts">
  import { tick } from 'svelte';
  import * as ValueFormat from './valueFieldFormat';
  import type { ValueKind } from './valueFieldFormat';

  const {
    value,
    min,
    max,
    step,
    kind,
    precision,
    tone,
    align = 'right',
    disabled = false,
    ariaLabel,
    floorLabel,
    ceilLabel,
    onChange,
  }: {
    value: number;
    min: number;
    max: number;
    step?: number;
    kind: ValueKind;
    precision?: number;
    tone?: 'signed';
    align?: 'center' | 'right';
    disabled?: boolean;
    ariaLabel?: string;
    // Shown instead of the number when value is at the floor (e.g. "Off" for
    // a -30 dB band level); editing still accepts numbers as usual.
    floorLabel?: string;
    // Same idea at the max end (e.g. "Off" for a 0 dBFS sub ceiling).
    ceilLabel?: string;
    onChange: (v: number) => void;
  } = $props();

  const effectivePrecision = $derived(precision ?? ValueFormat.defaultPrecisionFor(kind));
  const effectiveStep = $derived(step ?? Math.pow(10, -effectivePrecision));
  const effectiveUnit = $derived(ValueFormat.defaultUnitFor(kind));

  const atFloor = $derived(floorLabel !== undefined && value <= min);
  const atCeil = $derived(ceilLabel !== undefined && value >= max);
  const display = $derived(
    atFloor ? floorLabel! : atCeil ? ceilLabel! : ValueFormat.formatValue(kind, value, effectivePrecision),
  );

  // Disabled overrides any tone tinting.
  const toneColor = $derived(
    disabled ? 'var(--text-faint)' :
    tone === 'signed' && value > 0 ? 'var(--ok)' :
    tone === 'signed' && value < 0 ? 'var(--warn)' :
    'var(--text)',
  );

  let editing = $state(false);
  let draft = $state('');
  let invalid = $state(false);
  let inputEl = $state<HTMLInputElement | null>(null);
  // Pinned at beginEdit so the no-op check compares against the value the
  // user started from, not the live device-truth value (which can change
  // mid-edit via resync and would otherwise swallow a legitimate commit).
  let pinnedValue = 0;
  // Set when Escape exits the editor so the unmount-triggered blur
  // doesn't sneak the typed draft through commit().
  let suppressBlur = false;

  async function beginEdit(): Promise<void> {
    if (disabled || editing) return;
    pinnedValue = value;
    // Pre-fill with the raw numeric (no sign, no unit) at the active
    // precision so the editor cursor lands on a clean editable string.
    draft = value.toFixed(effectivePrecision);
    editing = true;
    invalid = false;
    await tick();
    inputEl?.focus();
    inputEl?.select();
  }

  // Two commit paths:
  //  - Enter: explicit commit attempt. Invalid input rejects with a red
  //    flash and keeps the editor open so the user can fix it (or Esc).
  //  - blur: implicit "abandon" gesture (clicking elsewhere, Tab). Invalid
  //    input reverts silently -- same as Esc in spirit, no need to trap
  //    focus inside the editor.
  function commit(fromEnter: boolean): void {
    if (suppressBlur) {
      suppressBlur = false;
      return;
    }
    const next = ValueFormat.parseAndClamp(draft, min, max, effectiveStep);
    if (next === null) {
      if (fromEnter) {
        // Mark red + stay editing so the user sees their input was rejected.
        invalid = true;
        return;
      }
      // Blur path: silent revert, close editor.
      editing = false;
      return;
    }
    editing = false;
    if (next === pinnedValue) return;   // user typed back what they started with -- no-op
    onChange(next);
  }

  // Arrow keys on the focused field step the value through the normal commit.
  function step1(dir: 1 | -1, shift: boolean): void {
    const next = ValueFormat.parseAndClamp(String(value + dir * effectiveStep * (shift ? 10 : 1)), min, max, effectiveStep);
    if (next !== null && next !== value) onChange(next);
  }

  function onFieldKey(e: KeyboardEvent): void {
    if (editing) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      beginEdit();
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !disabled) {
      e.preventDefault();
      step1(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
    }
  }

  function cancel(): void {
    suppressBlur = true;
    invalid = false;
    editing = false;
  }

  function onKey(e: KeyboardEvent): void {
    // stopPropagation prevents the keypress from bubbling to the .vf
    // wrapper's onkeydown -- without it, the wrapper would re-trigger
    // beginEdit() on the same Enter (because we just set editing=false),
    // re-opening the editor with a stale draft and committing it on the
    // next focus shift.
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
  }

  // Any new input (typing, paste, delete) clears the invalid marker --
  // the user is making a fresh attempt; let them see their progress
  // without the red error still glowing from the last try.
  function onInput(): void {
    if (invalid) invalid = false;
  }
</script>

<div
  class="vf"
  class:editing
  class:invalid
  class:disabled
  data-align={align}
  style:--toneColor={toneColor}
  onclick={beginEdit}
  onkeydown={onFieldKey}
  role="button"
  aria-label={ariaLabel}
  tabindex={disabled ? -1 : 0}
  aria-disabled={disabled}
>
  {#if editing}
    <input
      bind:this={inputEl}
      bind:value={draft}
      oninput={onInput}
      onblur={() => commit(false)}
      onkeydown={onKey}
      aria-label={ariaLabel}
      type="text"
      inputmode="decimal"
      spellcheck="false"
      autocomplete="off"
    />
  {:else}
    <span class="display">
      <span class="num">{display}</span>
      {#if effectiveUnit && !atFloor && !atCeil}<span class="unit">{effectiveUnit}</span>{/if}
    </span>
  {/if}
</div>

<style>
  .vf {
    position: relative;
    display: flex;
    align-items: center;
    box-sizing: border-box;
    width: 100%;
    height: var(--h-ctl);
    padding: 0 8px;
    font-size: var(--fs-l);
    border: none;
    border-radius: 0;
    background: transparent;
    box-shadow: inset 0 -1px 0 0 var(--border-hi);
    color: var(--text);
    font-family: var(--font-mono);
    cursor: pointer;
    user-select: none;
    transition: background 80ms, box-shadow 80ms;
    outline: none;
  }
  .vf:focus-visible {
    box-shadow:
      inset 0 -1px 0 0 var(--accent),
      var(--focus-ring);
  }
  .vf[data-align="center"] { justify-content: center; }
  .vf[data-align="right"]  { justify-content: flex-end; }

  .vf:hover:not(.editing):not(.disabled) {
    background: var(--wash);
    box-shadow:
      inset 0 -1px 0 0 var(--text-faint),
      0 -2px 6px -2px var(--border-hi) inset;
  }
  .vf.editing {
    background: color-mix(in oklab, var(--accent) var(--tint-weak), transparent);
    box-shadow:
      inset 0 -1px 0 0 var(--accent),
      0 0 0 1px var(--accent);
    cursor: text;
  }
  .vf.editing.invalid {
    background: color-mix(in oklab, var(--err) var(--tint), transparent);
    box-shadow:
      inset 0 -1px 0 0 var(--err),
      0 0 0 1px var(--err);
  }
  .vf.editing.invalid input { color: var(--err); }
  .vf.disabled {
    cursor: default;
    /* Single dim layer (U-P3 policy B): the container this sits in stays
       full-contrast; this is the one opacity dim on the control itself. */
    opacity: var(--dim-disabled);
  }

  .display {
    display: inline-flex;
    align-items: baseline;
    gap: 3px;
    white-space: nowrap;
  }
  .num {
    color: var(--toneColor);
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }
  .vf .unit {
    color: var(--text-faint);
    font-size: var(--fs-xs);
  }

  input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text);
    font-family: inherit;
    font-size: inherit;
    text-align: inherit;
    padding: 0 8px;
    box-sizing: border-box;
    font-variant-numeric: tabular-nums;
  }
  .vf[data-align="center"] input { text-align: center; }
  .vf[data-align="right"]  input { text-align: right; }
</style>
