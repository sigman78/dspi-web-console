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
  <BandTypeSelect value={band.type} onChange={(t) => onPatch({ type: t })} />
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
    grid-template-columns: 28px 24px 100px 84px 64px 72px;
    gap: 6px;
    padding: 5px 14px;
    align-items: center;
    border-top: 1px solid var(--wash);
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .row.off { opacity: 0.55; }
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
  .byp:disabled { opacity: 0.3; cursor: default; }
  .byp.on { color: var(--warn); }
</style>
