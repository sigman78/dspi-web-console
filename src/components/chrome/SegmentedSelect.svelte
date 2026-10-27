<script lang="ts" generics="T extends number | string">
  import { tick } from 'svelte';

  const {
    value,
    options,
    disabled = false,
    ariaLabel,
    disabledReason,
    onChange,
  }: {
    value: T;
    options: ReadonlyArray<{ value: T; label: string; disabled?: boolean }>;
    disabled?: boolean;
    ariaLabel: string;
    /** Why the group is disabled; keeps it focusable and describes it. */
    disabledReason?: string;
    onChange: (v: T) => void;
  } = $props();

  const uid = $props.id();
  const reasonId = `${uid}-reason`;
  const explained = $derived(disabled && !!disabledReason);

  // With no matching value (e.g. an unset choice) the first option stays reachable.
  const anyOn = $derived(options.some((o) => o.value === value));

  let root = $state<HTMLElement>();

  async function onKey(e: KeyboardEvent) {
    if (disabled) return;
    const idx = options.findIndex((o) => o.value === value);
    let next = idx;
    if (e.key === 'Home' || e.key === 'End') {
      const order = options.map((_, i) => i);
      if (e.key === 'End') order.reverse();
      next = order.find((i) => !options[i].disabled) ?? idx;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (idx < 0) return;
      const delta = e.key === 'ArrowRight' ? 1 : -1;
      for (let i = 1; i < options.length; i++) {
        const candidate = (idx + delta * i + options.length * i) % options.length;
        if (!options[candidate].disabled) { next = candidate; break; }
      }
    } else return;
    e.preventDefault();
    if (next === idx) return;
    onChange(options[next].value);
    await tick();
    if (value === options[next].value) {
      root?.querySelectorAll<HTMLElement>('[role=radio]')[next]?.focus();
    }
  }
</script>

<div
  class="seg"
  bind:this={root}
  role="radiogroup"
  aria-label={ariaLabel}
  aria-disabled={explained ? true : undefined}
  aria-describedby={explained ? reasonId : undefined}
  title={explained ? disabledReason : undefined}
  tabindex="-1"
  onkeydown={onKey}
>
  {#each options as opt, i (opt.value)}
    <button
      type="button"
      class="opt"
      class:on={opt.value === value}
      role="radio"
      aria-checked={opt.value === value}
      tabindex={opt.value === value || (!anyOn && i === 0) ? 0 : -1}
      disabled={(disabled && !explained) || opt.disabled}
      class:soft={explained}
      aria-disabled={explained ? true : undefined}
      onclick={() => { if (!disabled && !opt.disabled) onChange(opt.value); }}
    >
      {opt.label}
    </button>
  {/each}
</div>
{#if explained}<span id={reasonId} class="sr-only">{disabledReason}</span>{/if}

<style>
  .seg {
    display: inline-grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    border: 1px solid var(--border);
    border-radius: var(--radius-s);
    overflow: hidden;
    background: var(--wash-faint);
  }
  .opt {
    display: flex;
    align-items: center;
    justify-content: center;
    height: var(--h-ctl-s);
    font-family: var(--font-sans);
    font-size: var(--fs-m);
    padding: 0 8px;
    background: transparent;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    border-right: 1px solid var(--border);
  }
  .opt:last-child { border-right: none; }
  .opt:hover:not(:disabled):not(.soft):not(.on) {
    color: var(--text);
    background: var(--wash);
  }
  .opt:disabled, .opt.soft { cursor: default; opacity: var(--dim-disabled); }
  .opt.on {
    background: color-mix(in oklab, var(--ok) var(--tint), transparent);
    color: var(--ok);
    font-weight: 600;
  }
</style>
