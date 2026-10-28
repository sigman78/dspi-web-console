<script lang="ts">
  const {
    checked,
    disabled = false,
    label,
    ariaLabel,
    disabledReason,
    onChange,
  }: {
    checked: boolean;
    disabled?: boolean;
    label?: string;
    ariaLabel: string;
    /** Why the switch is disabled; keeps it focusable and describes it. */
    disabledReason?: string;
    onChange: (v: boolean) => void;
  } = $props();

  const uid = $props.id();
  const reasonId = `${uid}-reason`;
  const explained = $derived(disabled && !!disabledReason);
</script>

<button
  type="button"
  class="sw"
  class:on={checked}
  role="switch"
  aria-checked={checked}
  aria-label={ariaLabel}
  disabled={disabled && !explained}
  aria-disabled={explained ? true : undefined}
  aria-describedby={explained ? reasonId : undefined}
  title={explained ? disabledReason : undefined}
  onclick={() => { if (!disabled) onChange(!checked); }}
>
  <span class="track"><span class="knob"></span></span>
  {#if label}<span class="label">{label}</span>{/if}
</button>
{#if explained}<span id={reasonId} class="sr-only">{disabledReason}</span>{/if}

<style>
  .sw {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: none;
    border: none;
    padding: 3px 0;
    margin: 0;
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: var(--fs-m);
    line-height: 1.4;
    color: var(--text-dim);
  }
  .sw:hover:not(:disabled):not([aria-disabled='true']) { color: var(--text); }
  .sw:disabled, .sw[aria-disabled='true'] { cursor: default; opacity: var(--dim-disabled); }

  .track {
    --w: 26px; --h: 15px; --pad: 2px;
    position: relative;
    flex: 0 0 auto;
    width: var(--w);
    height: var(--h);
    border-radius: 999px;
    background: var(--wash-strong);
    border: 1px solid var(--border);
    transition: background-color 120ms ease, border-color 120ms ease;
  }

  .knob {
    position: absolute;
    top: var(--pad);
    left: var(--pad);
    width: calc(var(--h) - 2 * var(--pad) - 2px);
    height: calc(var(--h) - 2 * var(--pad) - 2px);
    border-radius: 50%;
    background: var(--text);
    box-shadow: 0 1px 2px oklch(0% 0 0 / 0.4);
    transition: transform 150ms cubic-bezier(0.34, 1.2, 0.64, 1);
  }
  .sw.on .track {
    background: color-mix(in oklab, var(--ok) var(--tint-strong), transparent);
    border-color: color-mix(in oklab, var(--ok) var(--tint-edge), transparent);
  }
  .sw.on .knob {
    transform: translateX(calc(var(--w) - var(--h)));
  }
  .sw:active:not(:disabled):not([aria-disabled='true']) .knob { transform: scale(0.92); }
  .sw.on:active:not(:disabled):not([aria-disabled='true']) .knob {
    transform: translateX(calc(var(--w) - var(--h))) scale(0.92);
  }

  .label { user-select: none; }

  @media (prefers-reduced-motion: reduce) {
    .track, .knob { transition: none; }
  }
</style>
