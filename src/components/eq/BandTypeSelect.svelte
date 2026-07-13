<script lang="ts" module>
  import { FilterType } from '@/domain';

  // UI label per FilterType. "Off" is the user-facing name for Flat.
  // Crossover labels are consumed by the crossover editor, not this select.
  export const TYPE_LABELS: Record<FilterType, string> = {
    [FilterType.Flat]: 'Off',
    [FilterType.Peaking]: 'Peaking',
    [FilterType.LowShelf]: 'Low Shelf',
    [FilterType.HighShelf]: 'High Shelf',
    [FilterType.LowPass]: 'Low Pass',
    [FilterType.HighPass]: 'High Pass',
    [FilterType.Notch]: 'Notch',
    [FilterType.Allpass]: 'Allpass',
    [FilterType.Allpass1]: 'Allpass 1st',
    [FilterType.LowShelf1]: 'Low Shelf 1st',
    [FilterType.HighShelf1]: 'High Shelf 1st',
    [FilterType.LinkwitzTransform]: 'Linkwitz',
    [FilterType.Lr2Lp]: 'LR2 LP',   [FilterType.Lr2Hp]: 'LR2 HP',
    [FilterType.Lr4Lp]: 'LR4 LP',   [FilterType.Lr4Hp]: 'LR4 HP',
    [FilterType.Lr6Lp]: 'LR6 LP',   [FilterType.Lr6Hp]: 'LR6 HP',
    [FilterType.Lr8Lp]: 'LR8 LP',   [FilterType.Lr8Hp]: 'LR8 HP',
    [FilterType.Bw1Lp]: 'BW1 LP',   [FilterType.Bw1Hp]: 'BW1 HP',
    [FilterType.Bw2Lp]: 'BW2 LP',   [FilterType.Bw2Hp]: 'BW2 HP',
    [FilterType.Bw3Lp]: 'BW3 LP',   [FilterType.Bw3Hp]: 'BW3 HP',
    [FilterType.Bw4Lp]: 'BW4 LP',   [FilterType.Bw4Hp]: 'BW4 HP',
    [FilterType.Bw5Lp]: 'BW5 LP',   [FilterType.Bw5Hp]: 'BW5 HP',
    [FilterType.Bw6Lp]: 'BW6 LP',   [FilterType.Bw6Hp]: 'BW6 HP',
    [FilterType.Bw7Lp]: 'BW7 LP',   [FilterType.Bw7Hp]: 'BW7 HP',
    [FilterType.Bw8Lp]: 'BW8 LP',   [FilterType.Bw8Hp]: 'BW8 HP',
    [FilterType.Bes2Lp]: 'BES2 LP', [FilterType.Bes2Hp]: 'BES2 HP',
    [FilterType.Bes4Lp]: 'BES4 LP', [FilterType.Bes4Hp]: 'BES4 HP',
    [FilterType.Bes6Lp]: 'BES6 LP', [FilterType.Bes6Hp]: 'BES6 HP',
    [FilterType.Bes8Lp]: 'BES8 LP', [FilterType.Bes8Hp]: 'BES8 HP',
  };

  // PEQ types this select offers. First-order types (V16+) are appended by
  // the EQ tab when the device reports the firstOrderEq capability;
  // crossover types never appear here (they live in the crossover editor).
  export const TYPE_ORDER: FilterType[] = [
    FilterType.Flat,
    FilterType.Peaking,
    FilterType.LowShelf,
    FilterType.HighShelf,
    FilterType.HighPass,
    FilterType.LowPass,
    FilterType.Notch,
    FilterType.Allpass,
  ];

  export const FIRST_ORDER_TYPES: FilterType[] = [
    FilterType.LowShelf1,
    FilterType.HighShelf1,
    FilterType.Allpass1,
  ];

  // Crossover editor's offering: Off + the full 32..63 range, LP/HP
  // interleaved in family/order sequence (matches the wire value order).
  export const XOVER_TYPE_ORDER: FilterType[] = [
    FilterType.Flat,
    ...Array.from({ length: 32 }, (_, i) => (FilterType.Lr2Lp + i) as FilterType),
  ];

  // Single source of truth for which PEQ types the EQ tab offers, given the
  // device's feature flags. Linkwitz Transform is display-only (see the
  // component below): it's never offered here, even on a capable device --
  // a band already set to it still renders correctly, just not selectable.
  export function offeredTypes(features: { firstOrderEq: boolean }): FilterType[] {
    let types = TYPE_ORDER;
    if (features.firstOrderEq) types = [...types, ...FIRST_ORDER_TYPES];
    return types;
  }
</script>

<script lang="ts">
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
  .bts:focus { outline: none; }
  .bts:focus-visible {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in oklab, var(--accent) 35%, transparent);
  }
  .bts.off { color: var(--text-faint); }
  .bts option { background: var(--panel-solid); color: var(--text); }
</style>
