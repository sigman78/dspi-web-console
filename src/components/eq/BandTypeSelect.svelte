<script lang="ts" module>
  import { FilterType } from '@/domain';

  // UI label per FilterType. "Off" is the user-facing name for Flat.
  export const TYPE_LABELS: Record<FilterType, string> = {
    [FilterType.Flat]: 'Off',
    [FilterType.Peaking]: 'Peaking',
    [FilterType.LowShelf]: 'Low Shelf',
    [FilterType.HighShelf]: 'High Shelf',
    [FilterType.LowPass]: 'Low Pass',
    [FilterType.HighPass]: 'High Pass',
    [FilterType.Notch]: 'Notch',
    [FilterType.Allpass]: 'Allpass',
  };

  // Notch/Allpass are intentionally omitted pending a UI design for these
  // filter types. Firmware support (V10 floor) is guaranteed; no capability
  // gate needed.
  export const TYPE_ORDER: FilterType[] = [
    FilterType.Flat,
    FilterType.Peaking,
    FilterType.LowShelf,
    FilterType.HighShelf,
    FilterType.HighPass,
    FilterType.LowPass,
  ];
</script>

<script lang="ts">
  const {
    value,
    onChange,
  }: {
    value: FilterType;
    onChange: (v: FilterType) => void;
  } = $props();

  const isOff = $derived(value === FilterType.Flat);
</script>

<select
  class="bts"
  class:off={isOff}
  value={value}
  onchange={(e) => onChange(Number((e.currentTarget as HTMLSelectElement).value) as FilterType)}
>
  {#each TYPE_ORDER as t (t)}
    <option value={t}>{TYPE_LABELS[t]}</option>
  {/each}
</select>

<style>
  .bts {
    width: 100%;
    background: transparent;
    color: var(--text);
    border: 1px solid transparent;
    border-radius: 3px;
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
  .bts:hover { background-color: color-mix(in oklab, var(--text) 6%, transparent); }
  .bts:focus { outline: none; border-color: var(--accent); }
  .bts.off { color: var(--text-faint); }
  .bts option { background: var(--panel-solid); color: var(--text); }
</style>
