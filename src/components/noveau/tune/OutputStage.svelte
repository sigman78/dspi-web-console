<script lang="ts">
  import { untrack } from 'svelte';
  import SliderField from '@/components/chrome/SliderField.svelte';
  import { formatSignedDb } from '@/components/chrome/format';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import ValueField from '@/components/chrome/ValueField.svelte';
  import SegmentedSelect from '@/components/chrome/SegmentedSelect.svelte';
  import * as Domain from '@/domain';
  import type { OutputModel } from '@/domain';
  import * as Runtime from '@/runtime';
  import { getSession } from '@/components/sessionContext';
  import InspectorSection from './InspectorSection.svelte';
  import BandTypeSelect from './BandTypeSelect.svelte';

  const { output }: { output: OutputModel } = $props();

  const s = getSession();
  const snap = $derived(s.mirror.current);
  const features = $derived(s.device.capabilities.features);
  const slot = $derived(output.wireIndex);

  // Falls back to the short name when the pair has no type to read.
  const typeLabel = $derived.by(() => {
    if (output.id === Domain.ChannelId.Pdm) return 'PDM';
    const pair = Domain.slotForOutputChannel(output.id);
    if (pair === null || !snap) return output.shortName;
    return Domain.outputSlotTypeLabel(snap.i2s.outputSlotTypes[pair]);
  });
  const lim = $derived(snap?.limiter[slot]);
  const gr = $derived(s.telemetry.limiterMeterDb?.[slot]);
  const showLimiter = $derived(features.limiter && lim !== undefined);
  const channel = $derived(snap?.channels.find((c) => c.id === output.id) ?? null);
  const xover = $derived(channel ? channel.xoverBands : []);
  const XOVER_TYPES: Domain.FilterType[] = [
    Domain.FilterType.Flat,
    ...Array.from({ length: Domain.XOVER_TYPE_LAST - Domain.XOVER_TYPE_FIRST + 1 }, (_, i) => (Domain.XOVER_TYPE_FIRST + i) as Domain.FilterType),
  ];
  function patchXover(i: number, p: Partial<Domain.FilterParams>): void {
    if (!channel) return;
    if (p.bypass !== undefined) Runtime.setXoverBypassLinked(s, channel.id, i, p.bypass);
    const { bypass: _bypass, ...rest } = p;
    if (Object.keys(rest).length > 0) Runtime.setXoverBandLinked(s, channel.id, i, { ...channel.xoverBands[i], ...rest });
  }

  const LINK_OPTIONS = Array.from({ length: Domain.Proc.LIMITER_LINK_GROUP_MAX + 1 }, (_, i) => ({
    value: i,
    label: Domain.Proc.limiterLinkLabel(i),
  }));
  // GR bar full scale,.
  const GR_FULL_DB = 30;
  const grPct = $derived(Math.round(Math.min(1, Math.max(0, (gr ?? 0) / GR_FULL_DB)) * 100));

  $effect(() => {
    if (!features.limiter) return;
    return untrack(() => s.telemetry.wantLimiterMeter());
  });

  // A missing mask means every output is set.
  const inMask = (mask: number | undefined): boolean => (((mask ?? 0xFFFF) >> slot) & 1) === 1;
  // Gain-reduction readout.
  const grText = (v: number | undefined): string => (v === undefined ? '—' : v >= 0.05 ? `${formatSignedDb(-v)} dB` : '0.0 dB');
</script>

<div class="stage">
  <div class="cols">
    <div class="col">
      <InspectorSection title="Output">
        <SliderField
          lane="gesture"
          holdKey={output.id}
          label="TRIM"
          value={output.gainDb}
          min={Domain.Mix.OUTPUT_GAIN_MIN_DB}
          max={Domain.Mix.OUTPUT_GAIN_MAX_DB}
          step={Domain.Mix.OUTPUT_GAIN_STEP_DB}
          kind="dB-signed"
          tone="signed"
          onChange={(v) => Runtime.setOutputGainLinked(s, output.id, v)}
        />
        <div class="prow">
          <span class="prow-lbl">DELAY</span>
          <span class="prow-ctl prow-fld">
            <ValueField
              kind="ms"
              min={Domain.Mix.OUTPUT_DELAY_MIN_MS}
              max={Domain.Mix.OUTPUT_DELAY_MAX_MS}
              step={Domain.Mix.OUTPUT_DELAY_STEP_MS}
              value={output.delayMs}
              onChange={(v) => Runtime.setOutputDelayLinked(s, output.id, v)}
            />
          </span>
        </div>
        <div class="prow">
          <span class="prow-lbl">MUTE</span>
          <span class="prow-ctl"><ToggleSwitch checked={output.muted} ariaLabel="Mute output" onChange={(v) => Runtime.setOutputMuted(s, slot, v)} /></span>
        </div>
        <div class="prow">
          <span class="prow-lbl">ENABLED</span>
          <span class="prow-ctl"><span class="t-value" title="Enable outputs on SETUP › OUTPUTS">{output.enabled ? 'YES' : 'NO'}</span></span>
        </div>
        <div class="prow">
          <span class="prow-lbl">TYPE</span>
          <span class="prow-ctl"><span class="t-value">{typeLabel}</span></span>
        </div>
      </InspectorSection>
    </div>

    {#if xover.length > 0}
      <div class="col xo-col">
        <InspectorSection title="Crossover">
          {#each xover as band, i (i)}
            {@const off = band.type === Domain.FilterType.Flat}
            <div class="prow xo" class:bypassed={band.bypass}>
              <span class="prow-lbl">X{i + 1}</span>
              <span class="prow-ctl">
                <BandTypeSelect value={band.type} onChange={(t) => patchXover(i, { type: t })} types={XOVER_TYPES} />
                <span class="prow-fld"><ValueField
                  kind="hz"
                  value={band.frequency}
                  min={Domain.Eq.FREQ_MIN_HZ}
                  max={Domain.Eq.FREQ_MAX_HZ}
                  step={Domain.Eq.FREQ_STEP_HZ}
                  align="right"
                  disabled={off || band.bypass}
                  onChange={(v) => patchXover(i, { frequency: v })}
                /></span>
                <ToggleSwitch checked={!band.bypass} ariaLabel={`Crossover band ${i + 1} active`} disabled={off} onChange={(v) => patchXover(i, { bypass: !v })} />
              </span>
            </div>
          {/each}
        </InspectorSection>
      </div>
    {/if}

    {#if showLimiter && lim}
      <div class="col lim-col">
        <InspectorSection title="Limiter">
          <div class="prow">
            <span class="prow-lbl">ENABLED</span>
            <span class="prow-ctl"><ToggleSwitch checked={lim.enabled} ariaLabel="Limiter" onChange={(v) => Runtime.setLimiterEnabled(s, slot, v)} /></span>
          </div>
          <div class="prow">
            <span class="prow-lbl">THRESHOLD</span>
            <span class="prow-ctl prow-fld">
              <ValueField
                kind="dB-signed"
                precision={1}
                min={Domain.Proc.LIMITER_THRESHOLD_MIN_DB}
                max={Domain.Proc.LIMITER_THRESHOLD_MAX_DB}
                step={Domain.Proc.LIMITER_THRESHOLD_STEP_DB}
                value={lim.thresholdDb}
                disabled={!lim.enabled}
                onChange={(v) => Runtime.setLimiterThreshold(s, slot, v)}
              />
            </span>
          </div>
          <div class="prow">
            <span class="prow-lbl">RELEASE</span>
            <span class="prow-ctl prow-fld">
              <ValueField
                kind="ms"
                precision={0}
                min={Domain.Proc.LIMITER_RELEASE_MIN_MS}
                max={Domain.Proc.LIMITER_RELEASE_MAX_MS}
                step={Domain.Proc.LIMITER_RELEASE_STEP_MS}
                value={lim.releaseMs}
                disabled={!lim.enabled}
                onChange={(v) => Runtime.setLimiterRelease(s, slot, v)}
              />
            </span>
          </div>
          <div class="prow">
            <span class="prow-lbl">LINK</span>
            <span class="prow-ctl"><SegmentedSelect
              value={lim.linkGroup}
              options={LINK_OPTIONS}
              ariaLabel="Limiter link group"
              onChange={(v) => Runtime.setLimiterLinkGroup(s, slot, v)}
            /></span>
          </div>
          <div class="prow">
            <span class="prow-lbl" title="Gain reduction">GR</span>
            <span class="gr">
              <span class="bar" aria-hidden="true">{#if s.telemetry.limiterMeterDb}<span class="fill" style:width="{grPct}%"></span>{/if}</span>
              <span class="t-value grv">{grText(gr)}</span>
            </span>
          </div>
        </InspectorSection>
      </div>
    {/if}
  </div>

  <div class="procs">
    <span class="prow-lbl">Processors</span>
    <span class="chips">
      <button type="button" class="chip hi" class:on={inMask(snap?.loudness.outputMask)} aria-pressed={inMask(snap?.loudness.outputMask)}
        disabled={!snap?.loudness.enabled}
        onclick={() => Runtime.toggleLoudnessOutputChannel(s, slot)}>LOUD</button>
      {#if features.psybass}
        <button type="button" class="chip hi" class:on={inMask(snap?.psybass.outputMask)} aria-pressed={inMask(snap?.psybass.outputMask)}
          disabled={!snap?.psybass.enabled}
          onclick={() => Runtime.togglePsybassOutputChannel(s, slot)}>PSY</button>
      {/if}
      {#if features.subharm}
        <button type="button" class="chip hi" class:on={inMask(snap?.subharm.outputMask)} aria-pressed={inMask(snap?.subharm.outputMask)}
          disabled={!snap?.subharm.enabled}
          onclick={() => Runtime.toggleSubharmOutputChannel(s, slot)}>SUB</button>
      {/if}
    </span>
    <span class="t-cap">program processors that include this output</span>
  </div>
</div>

<style>
  .stage {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .cols { display: flex; align-items: flex-start; min-width: 0; }
  /* Every column keeps its intrinsic width; the trim sits on the standard track. */
  .col { flex: 0 0 296px; min-width: 0; --rf-label: 64px; }
  .xo-col { flex: 0 0 230px; --rf-label: 84px; }
  .lim-col { flex: 0 0 280px; --rf-label: 84px; }
  .col + .col { border-left: 1px solid var(--border); padding-left: 16px; margin-left: 16px; }
  .stage :global(.sec) { border-top: none; }
  .stage :global(.prow) { --rf-track: auto; --rf-track-flex: 1; }
  .col:not(.xo-col, .lim-col) :global(.prow) { --rf-track: 136px; --rf-track-flex: 0 0 auto; }
  .xo .prow-lbl { flex: 0 0 28px; }
  .xo .prow-ctl > :global(select) { flex: 1 1 0; min-width: 0; }
  .xo.bypassed { opacity: var(--dim-off); }
  .gr { display: inline-flex; align-items: center; gap: 8px; }
  .bar { width: 96px; height: 6px; border-radius: var(--radius-xs); background: var(--wash-strong); overflow: hidden; }
  .fill { display: block; height: 100%; background: var(--warn); transition: width 100ms; }
  .grv { min-width: 64px; text-align: right; }
  .procs {
    height: 32px;
    display: flex;
    align-items: center;
    gap: 12px;
    border-top: 1px solid var(--border);
    min-width: 0;
  }
  .procs .prow-lbl { flex: 0 0 auto; }
  .procs .t-cap { white-space: nowrap; }
  .chips { display: inline-flex; gap: 6px; }
</style>
