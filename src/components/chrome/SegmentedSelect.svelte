<script lang="ts" generics="T extends number | string">
  const {
    value,
    options,
    disabled = false,
    size = 'md',
    ariaLabel,
    onChange,
  }: {
    value: T;
    options: ReadonlyArray<{ value: T; label: string; disabled?: boolean }>;
    disabled?: boolean;
    size?: 'sm' | 'md';
    ariaLabel: string;
    onChange: (v: T) => void;
  } = $props();

  function onKey(e: KeyboardEvent) {
    if (disabled) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const idx = options.findIndex((o) => o.value === value);
    if (idx < 0) return;
    const delta = e.key === 'ArrowRight' ? 1 : -1;
    let next = idx;
    for (let i = 1; i < options.length; i++) {
      const candidate = (idx + delta * i + options.length * i) % options.length;
      if (!options[candidate].disabled) { next = candidate; break; }
    }
    if (next !== idx) onChange(options[next].value);
  }
</script>

<div
  class="seg"
  class:sm={size === 'sm'}
  role="radiogroup"
  aria-label={ariaLabel}
  tabindex="-1"
  onkeydown={onKey}
>
  {#each options as opt (opt.value)}
    <button
      type="button"
      class="opt"
      class:on={opt.value === value}
      role="radio"
      aria-checked={opt.value === value}
      tabindex={opt.value === value ? 0 : -1}
      disabled={disabled || opt.disabled}
      onclick={() => { if (!disabled && !opt.disabled) onChange(opt.value); }}
    >
      {opt.label}
    </button>
  {/each}
</div>

<style>
  .seg {
    display: inline-grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
    background: color-mix(in oklab, var(--text) 2%, transparent);
  }
  .opt {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 1px;
    padding: 4px 10px;
    text-align: center;
    background: transparent;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    border-right: 1px solid var(--border);
  }
  .opt:last-child { border-right: none; }
  .opt:hover:not(:disabled):not(.on) {
    color: var(--text);
    background: color-mix(in oklab, var(--text) 4%, transparent);
  }
  .opt:disabled { cursor: default; opacity: 0.4; }
  .opt.on {
    background: color-mix(in oklab, var(--ok) 10%, transparent);
    color: var(--ok);
    font-weight: 600;
  }
  .sm .opt { font-size: 9px; padding: 3px 8px; }
</style>
