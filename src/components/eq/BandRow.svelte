<script lang="ts" module>
  // Shared with BandsPanel's header so the grid columns always line up.
  export const BAND_ROW_COLS = '28px 24px 100px 84px 64px 72px';
  export const BAND_ROW_COLS_LT = '28px 24px 100px 84px 64px 72px 84px 64px 60px';
</script>

<script lang="ts">
  import { FilterType, QP_DEFAULT, type FilterParams, Eq } from '@/domain';
  import ValueField from '@/components/chrome/ValueField.svelte';
  import { formatValue } from '@/components/chrome/valueFieldFormat';
  import BandTypeSelect, { isLtCapable } from './BandTypeSelect.svelte';

  const {
    index,
    band,
    onPatch,
    types,
  }: {
    index: number;
    band: FilterParams;
    onPatch: (patch: Partial<FilterParams>) => void;
    types?: FilterType[];
  } = $props();

  const off = $derived(band.type === FilterType.Flat);
  const bypassed = $derived(band.bypass);
  // First-order sections (V16+) are single-parameter: no Q, and the 1st-order
  // all-pass has no gain either.
  const firstOrder = $derived(
    band.type === FilterType.Allpass1 || band.type === FilterType.LowShelf1 || band.type === FilterType.HighShelf1,
  );
  const noGain = $derived(band.type === FilterType.Allpass1);

  // Linkwitz Transform: freq/q hold f0/Q0 as usual, but the gain slot is
  // reinterpreted as fp (Hz, not dB) and qp travels in its own field -- see
  // FilterType.LinkwitzTransform's doc comment. `ltCapable` gates the extra
  // FP/QP/DC columns on whether this device even offers the type, so a
  // non-LT-capable device never grows the row.
  const isLt = $derived(band.type === FilterType.LinkwitzTransform);
  const ltCapable = $derived(isLtCapable(types));
  const qp = $derived(band.qp ?? QP_DEFAULT);
  // The implied DC boost of the LT band (0 dB once the alignment reaches
  // fp==f0). Undefined/non-positive fp is firmware's "flat" case.
  const dcBoostDb = $derived(
    isLt && band.gain > 0 && band.frequency > 0 ? 40 * Math.log10(band.frequency / band.gain) : 0,
  );
  const dcBoostWarn = $derived(dcBoostDb > 15);
  const dcBoostText = $derived(formatValue('dB-signed', dcBoostDb, 1) + ' dB');

  const gridCols = $derived(ltCapable ? BAND_ROW_COLS_LT : BAND_ROW_COLS);
</script>

<div class="row" class:bypassed style:grid-template-columns={gridCols}>
  <div class="num">{String(index + 1).padStart(2, '0')}</div>
  <button
    class="byp"
    class:on={bypassed}
    title={bypassed ? 'Band bypassed — click to re-enable' : 'Bypass this band'}
    aria-label={bypassed ? 'Re-enable band' : 'Bypass band'}
    aria-pressed={bypassed}
    onclick={() => onPatch({ bypass: !bypassed })}
    disabled={off}
  >
    {#if bypassed}
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
        <line x1="2" y1="8" x2="14" y2="8" />
      </svg>
    {:else}
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 8 C 3.3 8 3.7 5 5 5 S 6.7 8 8 8 S 9.7 11 11 11 S 12.7 8 14 8" />
      </svg>
    {/if}
  </button>
  <BandTypeSelect value={band.type} onChange={(t) => onPatch({ type: t })} {types} />
  <ValueField
    kind="hz"
    value={band.frequency}
    min={isLt ? Eq.LT_FREQ_MIN_HZ : Eq.FREQ_MIN_HZ}
    max={isLt ? Eq.LT_FREQ_MAX_HZ : Eq.FREQ_MAX_HZ}
    step={Eq.FREQ_STEP_HZ}
    align="right"
    disabled={off || bypassed}
    onChange={(v) => onPatch({ frequency: v })}
  />
  <ValueField
    kind="q"
    value={band.q}
    min={isLt ? Eq.LT_Q_MIN : Eq.Q_MIN}
    max={isLt ? Eq.LT_Q_MAX : Eq.Q_MAX}
    step={Eq.Q_STEP}
    align="right"
    disabled={off || bypassed || firstOrder}
    onChange={(v) => onPatch({ q: v })}
  />
  {#if isLt}
    <div class="ph"></div>
  {:else}
    <ValueField
      kind="dB-signed"
      value={band.gain}
      min={Eq.BAND_GAIN_MIN_DB}
      max={Eq.BAND_GAIN_MAX_DB}
      step={Eq.BAND_GAIN_STEP_DB}
      tone="signed"
      align="right"
      disabled={off || bypassed || noGain}
      onChange={(v) => onPatch({ gain: v })}
    />
  {/if}
  {#if ltCapable}
    {#if isLt}
      <ValueField
        kind="hz"
        value={band.gain}
        min={Eq.LT_FREQ_MIN_HZ}
        max={Eq.LT_FREQ_MAX_HZ}
        step={Eq.FREQ_STEP_HZ}
        align="right"
        disabled={bypassed}
        onChange={(v) => onPatch({ gain: v })}
      />
      <ValueField
        kind="q"
        value={qp}
        min={Eq.LT_Q_MIN}
        max={Eq.LT_Q_MAX}
        step={Eq.Q_STEP}
        align="right"
        disabled={bypassed}
        onChange={(v) => onPatch({ qp: v })}
      />
      <div class="dcboost" class:warn={dcBoostWarn} title="Implied DC gain: 40·log10(F0/FP)">{dcBoostText}</div>
    {:else}
      <div class="ph"></div>
      <div class="ph"></div>
      <div class="ph"></div>
    {/if}
  {/if}
</div>

<style>
  .row {
    display: grid;
    /* grid-template-columns set inline (gridCols) -- grows by three columns
       (FP/QP/DC) on LT-capable devices; see BAND_ROW_COLS/BAND_ROW_COLS_LT. */
    gap: 6px;
    padding: 5px 14px;
    align-items: center;
    border-top: 1px solid var(--wash);
    font-family: var(--font-mono);
    font-size: 11px;
  }
  /* Unused FP/QP/DC cell on a non-LT row (or the GAIN cell on an LT row) --
     structurally present so the grid stays aligned, deliberately empty. */
  .ph { visibility: hidden; }
  .dcboost {
    text-align: right;
    padding-right: 8px;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  .dcboost.warn { color: var(--warn); font-weight: 600; }
  /* U-P3 policy B: no whole-row dim when the band is off (type = Flat). The
     row's structure and the FLAT type stay full-contrast; the freq/Q/gain
     ValueFields below are disabled in that state and carry the single dim
     layer alone. */
  /* Deliberately kept: bypass is a user toggle whose controls stay ENABLED
     (not disabled), so this dim is the one and only layer for that state --
     a real, single-layer visual distinction, not a stack. Do not touch. */
  .row.bypassed { opacity: 0.45; }
  .num { color: var(--text-faint); }
  .byp {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 20px;
    padding: 0;
    border-radius: var(--radius-s);
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-dim);
    cursor: pointer;
  }
  .byp:hover:not(:disabled) {
    color: var(--text);
    background: var(--wash);
  }
  .byp:disabled { opacity: var(--dim-disabled); cursor: default; }
  .byp.on { color: var(--warn); }
</style>
