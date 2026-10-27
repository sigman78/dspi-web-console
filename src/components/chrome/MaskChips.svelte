<script lang="ts">
  const {
    label,
    items,
    mask,
    disabled,
    wrap = false,
    onToggle,
  }: {
    label: string;
    items: ReadonlyArray<{ key: string | number; index: number; label: string; title: string }>;
    mask: number;
    disabled: boolean;
    /** Let the chips flow onto further lines instead of overflowing. */
    wrap?: boolean;
    onToggle: (index: number) => void;
  } = $props();

  const isSet = (i: number): boolean => (mask & (1 << i)) !== 0;
</script>

<div class="prow">
  <span class="prow-lbl">{label}</span>
  <span class="chips" class:wrap>
    {#each items as item (item.key)}
      <button
        type="button"
        class="chip hi"
        class:on={isSet(item.index)}
        aria-pressed={isSet(item.index)}
        aria-label={`${label} ${item.title}`}
        title={item.title}
        {disabled}
        onclick={() => onToggle(item.index)}
      >{item.label}</button>
    {/each}
  </span>
</div>

<style>
  .chips { display: inline-flex; flex-wrap: nowrap; gap: 4px; min-width: 0; }
  .chips.wrap { flex-wrap: wrap; }
  .chips .chip { min-width: 24px; padding: 0 4px; font-family: var(--font-mono); }
</style>
