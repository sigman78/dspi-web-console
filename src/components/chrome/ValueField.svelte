<script lang="ts">
  import { tick } from 'svelte';
  import {
    type ValueKind,
    defaultPrecisionFor,
    defaultUnitFor,
    formatValue,
    parseAndClamp,
  } from './valueFieldFormat';

  const {
    value,
    min,
    max,
    step,
    kind,
    precision,
    unit,
    tone,
    align = 'right',
    size = 'md',
    disabled = false,
    clamp = true,
    onChange,
    customFormat,
  }: {
    value: number;
    min: number;
    max: number;
    step?: number;
    kind: ValueKind;
    precision?: number;
    unit?: string;
    tone?: 'signed';
    align?: 'left' | 'center' | 'right';
    size?: 'sm' | 'md';
    disabled?: boolean;
    // When true (default), out-of-range values are clamped to [min,max]
    // and accepted. When false, out-of-range values are rejected just
    // like unparseable input -- Enter marks the cell red.
    clamp?: boolean;
    onChange: (v: number) => void;
    customFormat?: (v: number) => string;
  } = $props();

  const effectivePrecision = $derived(precision ?? defaultPrecisionFor(kind));
  const effectiveStep = $derived(step ?? Math.pow(10, -effectivePrecision));
  const effectiveUnit = $derived(unit ?? defaultUnitFor(kind));

  const display = $derived(customFormat ? customFormat(value) : formatValue(kind, value, effectivePrecision));

  // Color resolves entirely from existing CSS tokens -- no new theme colors.
  // Disabled overrides any tone tinting.
  const toneColor = $derived(
    disabled ? 'var(--text-faint)' :
    tone === 'signed' && value > 0 ? 'var(--ok)' :
    tone === 'signed' && value < 0 ? 'var(--warn)' :
    'var(--text)',
  );

  let editing = $state(false);
  let draft = $state('');
  let hover = $state(false);
  let invalid = $state(false);
  let inputEl = $state<HTMLInputElement | null>(null);
  // Pinned at beginEdit so the commit no-op check compares against what
  // the user *started* editing from, not the current device-truth value
  // (which can change underneath via resync). Without pinning, a snapshot
  // replace during an active edit causes commit() to silently no-op when
  // the user types the value they originally meant.
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
    const next = parseAndClamp(draft, min, max, effectiveStep, clamp);
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
  class:hover
  class:disabled
  data-align={align}
  data-size={size}
  style:--toneColor={toneColor}
  onclick={beginEdit}
  onmouseenter={() => (hover = true)}
  onmouseleave={() => (hover = false)}
  onkeydown={(e) => { if (!editing && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); beginEdit(); } }}
  role="button"
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
      type="text"
      inputmode="decimal"
      spellcheck="false"
      autocomplete="off"
    />
  {:else}
    <span class="display">
      <span class="num">{display}</span>
      {#if effectiveUnit}<span class="unit">{effectiveUnit}</span>{/if}
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
    border: none;
    border-radius: 0;
    background: transparent;
    box-shadow: inset 0 -1px 0 0 color-mix(in oklab, var(--text) 14%, transparent);
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
      0 0 0 2px color-mix(in oklab, var(--accent) 35%, transparent);
  }
  .vf[data-size="sm"] { height: 20px; padding: 0 6px; font-size: 10px; }
  .vf[data-size="md"] { height: 24px; padding: 0 8px; font-size: 11px; }
  .vf[data-align="left"]   { justify-content: flex-start; }
  .vf[data-align="center"] { justify-content: center; }
  .vf[data-align="right"]  { justify-content: flex-end; }

  .vf.hover:not(.editing):not(.disabled) {
    background: color-mix(in oklab, var(--text) 4%, transparent);
    box-shadow:
      inset 0 -1px 0 0 color-mix(in oklab, var(--text) 32%, transparent),
      0 -2px 6px -2px color-mix(in oklab, var(--text) 18%, transparent) inset;
  }
  .vf.editing {
    background: color-mix(in oklab, var(--accent) 6%, transparent);
    box-shadow:
      inset 0 -1px 0 0 var(--accent),
      0 0 0 1px var(--accent);
    cursor: text;
  }
  .vf.editing.invalid {
    background: color-mix(in oklab, var(--err) 10%, transparent);
    box-shadow:
      inset 0 -1px 0 0 var(--err),
      0 0 0 1px var(--err);
  }
  .vf.editing.invalid input { color: var(--err); }
  .vf.disabled {
    cursor: default;
    opacity: 0.4;
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
    font-size: 9px;
  }
  .vf[data-size="sm"] .unit { font-size: 8px; }

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
  .vf[data-size="sm"] input { padding: 0 6px; }
  .vf[data-align="left"]   input { text-align: left; }
  .vf[data-align="center"] input { text-align: center; }
  .vf[data-align="right"]  input { text-align: right; }
</style>
