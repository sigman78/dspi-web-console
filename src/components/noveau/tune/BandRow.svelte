<script lang="ts">
  import { FilterType, bandHasGain, bandHasQ, type FilterParams, Eq } from '@/domain';
  import ValueField from '@/components/chrome/ValueField.svelte';
  import BandTypeSelect from './BandTypeSelect.svelte';
  import BypassButton from './BypassButton.svelte';

  const {
    index,
    band,
    onPatch,
    types,
    columns = '28px 24px 100px 84px 64px 72px',
  }: {
    index: number;
    band: FilterParams;
    onPatch: (patch: Partial<FilterParams>) => void;
    types?: FilterType[];
    /** grid-template-columns; a header row above must use the same value. */
    columns?: string;
  } = $props();

  const off = $derived(band.type === FilterType.Flat);
  const bypassed = $derived(band.bypass);
  // Linkwitz Transform is display-only in this UI (see BandTypeSelect): a
  // band already set to it renders read-only -- freq/Q show f0/Q0 but can't
  // be edited, and gain has no dB meaning here (it's fp in Hz on the wire),
  // so that cell shows a dash instead.
  const isLt = $derived(band.type === FilterType.LinkwitzTransform);
</script>

<div class="row" class:bypassed style:grid-template-columns={columns}>
  <div class="num">{String(index + 1).padStart(2, '0')}</div>
  <BypassButton {bypassed} disabled={off} onToggle={() => onPatch({ bypass: !bypassed })} />
  <BandTypeSelect value={band.type} onChange={(t) => onPatch({ type: t })} {types} />
  <ValueField
    kind="hz"
    value={band.frequency}
    min={Eq.FREQ_MIN_HZ}
    max={Eq.FREQ_MAX_HZ}
    step={Eq.FREQ_STEP_HZ}
    align="right"
    disabled={off || bypassed || isLt}
    onChange={(v) => onPatch({ frequency: v })}
  />
  <ValueField
    kind="q"
    value={band.q}
    min={Eq.Q_MIN}
    max={Eq.Q_MAX}
    step={Eq.Q_STEP}
    align="right"
    disabled={off || bypassed || !bandHasQ(band.type) || isLt}
    onChange={(v) => onPatch({ q: v })}
  />
  {#if isLt}
    <div class="gainDash">—</div>
  {:else}
    <ValueField
      kind="dB-signed"
      value={band.gain}
      min={Eq.BAND_GAIN_MIN_DB}
      max={Eq.BAND_GAIN_MAX_DB}
      step={Eq.BAND_GAIN_STEP_DB}
      tone="signed"
      align="right"
      disabled={off || bypassed || !bandHasGain(band.type)}
      onChange={(v) => onPatch({ gain: v })}
    />
  {/if}
</div>

<style>
  .row {
    display: grid;
    /* grid-template-columns set inline (columns prop). */
    gap: 6px;
    padding: 5px 14px;
    align-items: center;
    border-top: 1px solid var(--wash);
    font-family: var(--font-mono);
    font-size: 11px;
  }
  /* Linkwitz Transform's gain slot has no dB meaning here (it's fp in Hz on
     the wire) -- placeholder in the GAIN cell instead of a real control. */
  .gainDash {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    height: 24px;
    padding: 0 8px;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  .num { color: var(--text-faint); }
</style>
