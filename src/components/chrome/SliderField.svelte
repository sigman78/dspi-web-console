<script lang="ts">
  import ValueField from '@/components/chrome/ValueField.svelte';
  import { createAckHold } from '@/components/chrome/ackHold.svelte';
  import { defaultPrecisionFor, formatValue, type ValueKind } from '@/components/chrome/valueFieldFormat';

  const {
    value,
    min,
    max,
    step,
    kind,
    label,
    ariaLabel,
    tone,
    precision,
    floorLabel,
    ceilLabel,
    log = false,
    disabled = false,
    disabledReason,
    placeholder,
    lane,
    onChange,
    onPreview,
    resetTo,
    holdKey,
  }: {
    value: number;
    min: number;
    max: number;
    step: number;
    kind: ValueKind;
    label?: string;
    ariaLabel?: string;
    tone?: 'signed';
    precision?: number;
    floorLabel?: string;
    ceilLabel?: string;
    /** Logarithmic slider travel (frequency, Q). */
    log?: boolean;
    disabled?: boolean;
    /** Why the slider is disabled; described and shown as a tooltip. */
    disabledReason?: string;
    /** Shown in place of the field when set (e.g. a dash for a parameter the type lacks). */
    placeholder?: string;
    /** `scrub` writes on every move; `gesture` previews on every move and writes once per gesture. */
    lane: 'scrub' | 'gesture';
    onChange: (v: number) => void;
    /** Live value on every move of a `gesture` slider. */
    onPreview?: (v: number) => void;
    /** Adds a reset chip that writes this value. */
    resetTo?: number;
    /** The ack hold is dropped when this changes (the slider now shows a different target). */
    holdKey?: string | number;
  } = $props();

  const hold = createAckHold<number>();
  let live = $state<number | null>(null);
  let startValue: number | null = null;
  let sent: number | null = null;

  const SPAN = 1000;
  const toPos = (v: number): number => (log ? (Math.log(v / min) / Math.log(max / min)) * SPAN : v);
  const fromPos = (p: number): number => {
    const v = log ? min * Math.pow(max / min, p / SPAN) : p;
    const snapped = Math.round(v / step) * step;
    return Math.min(max, Math.max(min, Number(snapped.toFixed(4))));
  };

  $effect(() => {
    void holdKey;
    hold.release();
  });
  $effect(() => hold.release);

  const shown = $derived(live ?? hold.value ?? value);
  const name = $derived(ariaLabel ?? label);
  const uid = $props.id();
  const reasonId = `${uid}-reason`;
  const explained = $derived(disabled && !!disabledReason);

  function commit(v: number): void {
    if (lane === 'gesture') {
      const base = value;
      hold.begin(v, () => value !== base);
    }
    onChange(v);
  }

  function begin(): void {
    hold.release();
    if (startValue === null) startValue = value;
  }

  function move(v: number): void {
    live = v;
    if (lane === 'scrub') {
      sent = v;
      onChange(v);
    } else {
      onPreview?.(v);
    }
  }

  function finish(): void {
    const start = startValue;
    startValue = null;
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    const v = live;
    const lastSent = sent;
    sent = null;
    if (start === null || v === null) return;
    live = null;
    if (lane === 'scrub') {
      if (v !== lastSent) onChange(v);
    } else if (v !== start) {
      commit(v);
    }
  }

  $effect(() => () => {
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
  });

  let inputEl = $state<HTMLInputElement>();

  function onPointerDown(): void {
    if (disabled) return;
    begin();
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }
  function onInput(e: Event): void {
    if (disabled) {
      if (inputEl) inputEl.value = String(toPos(shown));
      return;
    }
    const p = parseFloat((e.target as HTMLInputElement).value);
    if (Number.isNaN(p)) return;
    begin();
    move(fromPos(p));
  }

  const KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'];
  function onKeyDown(e: KeyboardEvent): void {
    if (!KEYS.includes(e.key)) return;
    e.preventDefault();
    if (disabled) return;
    begin();
    const cur = live ?? value;
    const dir = e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'PageDown' ? -1 : 1;
    const mult = e.shiftKey ? 10 : 1;
    let next: number;
    if (e.key === 'Home') next = min;
    else if (e.key === 'End') next = max;
    else if (log) {
      next = fromPos(toPos(cur) + dir * mult);
      if (next === cur) next = Math.min(max, Math.max(min, Number((cur + dir * step * mult).toFixed(4))));
    } else next = Math.min(max, Math.max(min, Number((cur + dir * step * mult).toFixed(4))));
    move(next);
  }
  function onKeyUp(e: KeyboardEvent): void {
    if (KEYS.includes(e.key)) finish();
  }
</script>

<div class="prow rf">
  {#if label}<span class="prow-lbl" title={label}>{label}</span>{/if}
  <input
    type="range"
    min={log ? 0 : min}
    max={log ? SPAN : max}
    step={log ? 1 : step}
    value={toPos(shown)}
    bind:this={inputEl}
    disabled={disabled && !explained}
    aria-disabled={explained ? true : undefined}
    aria-label={name}
    aria-describedby={explained ? reasonId : undefined}
    title={explained ? disabledReason : undefined}
    onpointerdown={onPointerDown}
    oninput={onInput}
    onkeydown={onKeyDown}
    onkeyup={onKeyUp}
    onblur={finish}
  />
  <div class="val">
    {#if placeholder !== undefined}
      <span class="t-value none">{placeholder}</span>
    {:else}
      <ValueField value={shown} {min} {max} {step} {kind} {tone} {precision} {floorLabel} {ceilLabel} {disabled} ariaLabel={name ? `${name} value` : undefined} align="right" onChange={commit} />
    {/if}
  </div>
  {#if explained}<span id={reasonId} class="sr-only">{disabledReason}</span>{/if}
  {#if resetTo !== undefined}
    <button type="button" class="chip icon" disabled={disabled || shown === resetTo}
      aria-label={`Reset ${name ?? ''} to ${formatValue(kind, resetTo, precision ?? defaultPrecisionFor(kind)).trim()}`}
      title="Reset" onclick={() => commit(resetTo)}>↺</button>
  {/if}
</div>

<style>
  input[type='range'] { flex: var(--rf-track-flex, 1); width: var(--rf-track, auto); min-width: 40px; margin: 0; accent-color: var(--accent); }
  input[type='range']:disabled, input[type='range'][aria-disabled='true'] { opacity: var(--dim-disabled); cursor: default; }
  .val { flex: 0 0 var(--rf-value, 84px); }
  .none {
    display: block;
    text-align: right;
    padding-right: 8px;
    color: var(--text-faint);
  }
</style>
