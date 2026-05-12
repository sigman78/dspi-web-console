<script lang="ts">
  import { FilterType, type FilterParams } from '../../domain/filter';
  import * as Eq from '../../domain/eqLimits';
  import ValueField from '../chrome/ValueField.svelte';
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
</script>

<div class="row" class:off>
  <div class="num">{String(index + 1).padStart(2, '0')}</div>
  <BandTypeSelect value={band.type} onChange={(t) => onPatch({ type: t })} />
  <div></div>
  <ValueField
    kind="hz"
    value={band.frequency}
    min={Eq.EQ_FREQ_MIN_HZ}
    max={Eq.EQ_FREQ_MAX_HZ}
    step={Eq.EQ_FREQ_STEP_HZ}
    align="right"
    disabled={off}
    onChange={(v) => onPatch({ frequency: v })}
  />
  <ValueField
    kind="q"
    value={band.q}
    min={Eq.EQ_Q_MIN}
    max={Eq.EQ_Q_MAX}
    step={Eq.EQ_Q_STEP}
    align="right"
    disabled={off}
    onChange={(v) => onPatch({ q: v })}
  />
  <ValueField
    kind="dB-signed"
    value={band.gain}
    min={Eq.EQ_BAND_GAIN_MIN_DB}
    max={Eq.EQ_BAND_GAIN_MAX_DB}
    step={Eq.EQ_BAND_GAIN_STEP_DB}
    tone="signed"
    align="right"
    disabled={off}
    onChange={(v) => onPatch({ gain: v })}
  />
</div>

<style>
  .row {
    display: grid;
    grid-template-columns: 28px 100px 1fr 84px 64px 72px;
    gap: 6px;
    padding: 5px 14px;
    align-items: center;
    border-top: 1px solid color-mix(in oklab, var(--text) 4%, transparent);
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .row.off { opacity: 0.55; }
  .num { color: var(--text-faint); }
</style>
