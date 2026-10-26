<script lang="ts">
  import ValueField from '@/components/chrome/ValueField.svelte';
  import type { ValueKind } from '@/components/chrome/valueFieldFormat';

  const {
    label,
    value,
    min,
    max,
    step,
    kind,
    tone,
    log = false,
    disabled = false,
    placeholder,
    onPreview,
    onCommit,
  }: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    kind: ValueKind;
    tone?: 'signed';
    /** Logarithmic slider travel (frequency, Q). */
    log?: boolean;
    disabled?: boolean;
    /** Shown in place of the field when set (e.g. a dash for a parameter the type lacks). */
    placeholder?: string;
    /** Fires with the live value on every slider move; most fields leave it unset. */
    onPreview?: (v: number) => void;
    onCommit: (v: number) => void;
  } = $props();

  // The slider previews locally and writes once per gesture (pointer release,
  // key release, blur): these verbs are click-paced, never per-move. After the
  // write the preview is held until the mirror moves, or the fallback fires,
  // so the knob does not snap back before the ack.
  const HOLD_FALLBACK_MS = 1500;
  let live = $state<number | null>(null);
  let startValue: number | null = null;
  let holding = false;
  let holdBase = 0;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;

  const SPAN = 1000;
  const toPos = (v: number): number => (log ? (Math.log(v / min) / Math.log(max / min)) * SPAN : v);
  const fromPos = (p: number): number => {
    const v = log ? min * Math.pow(max / min, p / SPAN) : p;
    const snapped = Math.round(v / step) * step;
    return Math.min(max, Math.max(min, Number(snapped.toFixed(4))));
  };

  const shown = $derived(live ?? value);

  function releaseHold() {
    if (holdTimer !== null) clearTimeout(holdTimer);
    holdTimer = null;
    holding = false;
    live = null;
  }

  function begin() {
    if (holding) releaseHold();
    if (startValue === null) startValue = value;
  }

  function finish() {
    const start = startValue;
    startValue = null;
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    if (start === null || live === null) return;
    const v = live;
    if (v === start) {
      live = null;
      return;
    }
    holding = true;
    holdBase = value;
    holdTimer = setTimeout(releaseHold, HOLD_FALLBACK_MS);
    onCommit(v);
  }

  $effect(() => {
    if (holding && value !== holdBase) releaseHold();
  });
  $effect(() => () => {
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    if (holdTimer !== null) clearTimeout(holdTimer);
  });

  function onPointerDown() {
    begin();
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }
  function onInput(e: Event) {
    begin();
    live = fromPos(parseFloat((e.target as HTMLInputElement).value));
    onPreview?.(live);
  }

  const KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
  function onKeyDown(e: KeyboardEvent) {
    if (!KEYS.includes(e.key)) return;
    e.preventDefault();
    begin();
    const cur = live ?? value;
    const dir = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 1;
    const mult = e.shiftKey ? 10 : 1;
    let next: number;
    if (e.key === 'Home') next = min;
    else if (e.key === 'End') next = max;
    else if (log) next = fromPos(toPos(cur) + dir * mult);
    else next = Math.min(max, Math.max(min, Number((cur + dir * step * mult).toFixed(4))));
    live = next;
  }
  function onKeyUp(e: KeyboardEvent) {
    if (KEYS.includes(e.key)) finish();
  }
</script>

<div class="rf">
  <span class="lbl">{label}</span>
  <input
    type="range"
    min={log ? 0 : min}
    max={log ? SPAN : max}
    step={log ? 1 : step}
    value={toPos(shown)}
    {disabled}
    aria-label={label}
    onpointerdown={onPointerDown}
    oninput={onInput}
    onkeydown={onKeyDown}
    onkeyup={onKeyUp}
    onblur={finish}
  />
  <div class="val">
    {#if placeholder !== undefined}
      <span class="none">{placeholder}</span>
    {:else}
      <ValueField value={shown} {min} {max} {step} {kind} {tone} {disabled} align="right" onChange={onCommit} />
    {/if}
  </div>
</div>

<style>
  .rf {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 24px;
  }
  .lbl {
    flex: 0 0 var(--rf-label, 64px);
    font-family: var(--font-sans);
    font-size: 11px;
    color: var(--text-dim);
    white-space: nowrap;
  }
  input[type='range'] { flex: var(--rf-track-flex, 1); width: var(--rf-track, auto); min-width: 40px; margin: 0; }
  .val { flex: 0 0 var(--rf-value, 84px); }
  .none {
    display: block;
    text-align: right;
    padding-right: 8px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-faint);
  }
</style>
