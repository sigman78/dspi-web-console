<script lang="ts">
  const {
    label,
    items,
    mask,
    disabled,
    onToggle,
  }: {
    label: string;
    items: ReadonlyArray<{ key: string | number; index: number; label: string; title: string }>;
    mask: number;
    disabled: boolean;
    onToggle: (index: number) => void;
  } = $props();

  const isSet = (i: number) => (mask & (1 << i)) !== 0;
</script>

<span class="microlbl">{label}</span>
<div class="chips span2">
  {#each items as item (item.key)}
    <button
      type="button"
      class="chip"
      class:on={isSet(item.index)}
      {disabled}
      title={item.title}
      aria-label={`${label} ${item.title}`}
      aria-pressed={isSet(item.index)}
      onclick={() => { if (!disabled) onToggle(item.index); }}
    >
      {item.label}
    </button>
  {/each}
</div>

<style>
  .span2 { grid-column: 2 / span 2; }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    min-width: 24px;
    height: 24px;
    padding: 0 4px;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    color: var(--text-dim);
    background: var(--wash-faint);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
  }
  .chip:hover:not(:disabled):not(.on) {
    color: var(--text);
    background: var(--wash);
  }
  .chip.on {
    color: var(--ok);
    background: color-mix(in oklab, var(--ok) 12%, transparent);
    border-color: color-mix(in oklab, var(--ok) 40%, var(--border));
  }
  .chip:disabled { cursor: default; opacity: var(--dim-disabled); }
</style>
