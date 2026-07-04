<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import ValueField from '@/components/chrome/ValueField.svelte';
  import BandTypeSelect, { XOVER_TYPE_ORDER } from './BandTypeSelect.svelte';
  import { FilterType, Eq, type ChannelModel, type FilterParams } from '@/domain';
  import { setXoverBand, setXoverBypass } from '@/runtime';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();

  const { channel }: { channel: ChannelModel } = $props();

  function patch(i: number, p: Partial<FilterParams>) {
    if ('bypass' in p && p.bypass !== undefined) {
      setXoverBypass(s, channel.id, i, p.bypass);
    }
    const { bypass: _bypass, ...rest } = p;
    if (Object.keys(rest).length > 0) {
      setXoverBand(s, channel.id, i, { ...channel.xoverBands[i], ...rest });
    }
  }
</script>

<Panel code="EQ.04" title="CROSSOVER · 4 BANDS">
  <div class="head">
    <div>#</div>
    <div></div>
    <div>TYPE</div>
    <div class="r">FREQ</div>
  </div>
  {#each channel.xoverBands as band, i (i)}
    {@const off = band.type === FilterType.Flat}
    <div class="row" class:bypassed={band.bypass}>
      <div class="num">X{i + 1}</div>
      <button
        class="byp"
        class:on={band.bypass}
        title={band.bypass ? 'Band bypassed — click to re-enable' : 'Bypass this band'}
        aria-pressed={band.bypass}
        onclick={() => patch(i, { bypass: !band.bypass })}
        disabled={off}
      >—</button>
      <BandTypeSelect value={band.type} onChange={(t) => patch(i, { type: t })} types={XOVER_TYPE_ORDER} />
      <ValueField
        kind="hz"
        value={band.frequency}
        min={Eq.FREQ_MIN_HZ}
        max={Eq.FREQ_MAX_HZ}
        step={Eq.FREQ_STEP_HZ}
        align="right"
        disabled={off || band.bypass}
        onChange={(v) => patch(i, { frequency: v })}
      />
    </div>
  {/each}
</Panel>

<style>
  .head, .row {
    display: grid;
    grid-template-columns: 28px 24px 130px 84px;
    gap: 6px;
    padding: 5px 14px;
    align-items: center;
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .head { color: var(--text-faint); padding-top: 8px; }
  .row { border-top: 1px solid var(--wash); }
  .row.bypassed { opacity: 0.45; }
  .r { text-align: right; }
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
  .byp:hover:not(:disabled) { color: var(--text); background: var(--wash); }
  .byp:disabled { opacity: var(--dim-disabled); cursor: default; }
  .byp.on { color: var(--warn); }
</style>
