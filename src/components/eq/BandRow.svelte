<script lang="ts">
  import { FilterType, type FilterParams, Eq } from '@/domain';
  import ValueField from '@/components/chrome/ValueField.svelte';
  import BandTypeSelect from './BandTypeSelect.svelte';

  const {
    index,
    band,
    onPatch,
  }: {
    index: number;
    band: FilterParams;
    onPatch: (patch: Partial<FilterParams>) => void;
  } = $props();

  const off = $derived(band.type === FilterType.Flat);
  const bypassed = $derived(band.bypass);
</script>

<div class="row" class:off class:bypassed>
  <div class="num">{String(index + 1).padStart(2, '0')}</div>
  <BandTypeSelect value={band.type} onChange={(t) => onPatch({ type: t })} />
  <button
    class="byp"
    class:on={bypassed}
    title={bypassed ? 'Band bypassed — click to re-enable' : 'Bypass this band'}
    aria-label={bypassed ? 'Re-enable band' : 'Bypass band'}
    onclick={() => onPatch({ bypass: !bypassed })}
    disabled={off}
  >BYP</button>
  <ValueField
    kind="hz"
    value={band.frequency}
    min={Eq.FREQ_MIN_HZ}
    max={Eq.FREQ_MAX_HZ}
    step={Eq.FREQ_STEP_HZ}
    align="right"
    disabled={off || bypassed}
    onChange={(v) => onPatch({ frequency: v })}
  />
  <ValueField
    kind="q"
    value={band.q}
    min={Eq.Q_MIN}
    max={Eq.Q_MAX}
    step={Eq.Q_STEP}
    align="right"
    disabled={off || bypassed}
    onChange={(v) => onPatch({ q: v })}
  />
  <ValueField
    kind="dB-signed"
    value={band.gain}
    min={Eq.BAND_GAIN_MIN_DB}
    max={Eq.BAND_GAIN_MAX_DB}
    step={Eq.BAND_GAIN_STEP_DB}
    tone="signed"
    align="right"
    disabled={off || bypassed}
    onChange={(v) => onPatch({ gain: v })}
  />
</div>

<style>
  .row {
    display: grid;
    grid-template-columns: 28px 100px 28px 84px 64px 72px;
    gap: 6px;
    padding: 5px 14px;
    align-items: center;
    border-top: 1px solid color-mix(in oklab, var(--text) 4%, transparent);
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .row.off { opacity: 0.55; }
  .row.bypassed { opacity: 0.45; }
  .num { color: var(--text-faint); }
  .byp {
    font-family: var(--font-mono);
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.5px;
    padding: 2px 3px;
    border-radius: 3px;
    background: color-mix(in oklab, var(--text) 4%, transparent);
    border: 1px solid var(--border);
    color: var(--text-faint);
    cursor: pointer;
    line-height: 1;
  }
  .byp:hover:not(:disabled) { color: var(--text-dim); border-color: var(--border-hi); }
  .byp:disabled { opacity: 0.3; cursor: default; }
  .byp.on {
    background: color-mix(in oklab, var(--warn) 14%, transparent);
    border-color: color-mix(in oklab, var(--warn) 50%, var(--border));
    color: var(--warn);
  }
</style>
