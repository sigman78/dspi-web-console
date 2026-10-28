<script lang="ts">
  import { FilterType, TYPE_LABELS, TYPE_ORDER } from '@/domain';

  const {
    value,
    onChange,
    types = TYPE_ORDER,
  }: {
    value: FilterType;
    onChange: (v: FilterType) => void;
    // Offered types; callers append FIRST_ORDER_TYPES on firstOrderEq-capable devices.
    types?: FilterType[];
  } = $props();

  const isOff = $derived(value === FilterType.Flat);
  // A band already set to Linkwitz Transform (another host, a preset, or
  // device state) keeps showing "Linkwitz" selected even though `types`
  // never offers it -- appended as a disabled option so it renders as the
  // current value but can't be re-picked. Switching away to any other
  // offered type still works normally.
  const showLt = $derived(
    value === FilterType.LinkwitzTransform && !types.includes(FilterType.LinkwitzTransform),
  );
</script>

<select
  class="bts"
  class:off={isOff}
  value={value}
  onchange={(e) => onChange(Number((e.currentTarget as HTMLSelectElement).value) as FilterType)}
>
  {#each types as t (t)}
    <option value={t}>{TYPE_LABELS[t]}</option>
  {/each}
  {#if showLt}
    <option value={FilterType.LinkwitzTransform} disabled>{TYPE_LABELS[FilterType.LinkwitzTransform]}</option>
  {/if}
</select>

<style>
  .bts {
    width: 100%;
    background: transparent;
    color: var(--text);
    border: 1px solid transparent;
    border-radius: var(--radius-s);
    padding: 2px 4px;
    font-family: var(--font-sans);
    font-size: 11px;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
    background-image:
      linear-gradient(45deg, transparent 50%, var(--text-faint) 50%),
      linear-gradient(135deg, var(--text-faint) 50%, transparent 50%);
    background-position:
      calc(100% - 8px) center,
      calc(100% - 4px) center;
    background-size: 4px 4px, 4px 4px;
    background-repeat: no-repeat;
    padding-right: 16px;
  }
  .bts:hover { background-color: var(--wash-strong); }
  .bts:focus-visible {
    border-color: var(--accent);
    box-shadow: var(--focus-ring);
    outline: none;
  }
  .bts.off { color: var(--text-faint); }
  .bts option { background: var(--panel-solid); color: var(--text); }
</style>
