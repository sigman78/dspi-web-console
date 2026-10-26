<script lang="ts">
  import { untrack } from 'svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import ValueField from '@/components/chrome/ValueField.svelte';
  import SegmentedSelect from '@/components/chrome/SegmentedSelect.svelte';
  import { ChannelId, Mix, OutputSlotType, Proc, slotForOutputChannel, type OutputModel } from '@/domain';
  import * as Runtime from '@/runtime';
  import { getSession } from '@/components/sessionContext';
  import RangeField from './RangeField.svelte';
  import InspectorSection from './InspectorSection.svelte';

  const { output }: { output: OutputModel } = $props();

  const s = getSession();
  const snap = $derived(s.mirror.current);
  const features = $derived(s.device.capabilities.features);
  const slot = $derived(output.wireIndex);

  // Same projection the matrix header uses, but available for disabled outputs too.
  const typeLabel = $derived.by(() => {
    if (output.id === ChannelId.Pdm) return 'PDM';
    const pair = slotForOutputChannel(output.id);
    if (pair === null || !snap) return output.shortName;
    return snap.i2s.outputSlotTypes[pair] === OutputSlotType.I2s ? 'I2S' : 'SPDIF';
  });
  const lim = $derived(snap?.limiter[slot]);
  const gr = $derived(s.telemetry.limiterMeterDb?.[slot]);
  const showProcs = $derived(features.loudnessOutputMask || features.psybass || features.subharm);
  const showLimiter = $derived(features.limiter && lim !== undefined);

  const LINK_OPTIONS = Array.from({ length: Proc.LIMITER_LINK_GROUP_MAX + 1 }, (_, i) => ({
    value: i,
    label: i === 0 ? '—' : String(i),
  }));
  // GR bar full scale, matching LimiterPanel.
  const GR_FULL_DB = 30;
  const grPct = $derived(Math.round(Math.min(1, Math.max(0, (gr ?? 0) / GR_FULL_DB)) * 100));

  $effect(() => {
    if (!features.limiter) return;
    return untrack(() => s.telemetry.wantLimiterMeter());
  });

  // A missing mask means every output is set, as in the classic panels.
  const inMask = (mask: number | undefined): boolean => (((mask ?? 0xFFFF) >> slot) & 1) === 1;
  // Same readout as LimiterPanel.
  const grText = (v: number | undefined): string => (v === undefined ? '—' : v >= 0.05 ? `−${v.toFixed(1)} dB` : '0.0 dB');
</script>

<div class="stage">
  <div class="cols">
    <div class="col">
      <InspectorSection title="Output">
        <div class="r">
          <RangeField
            label="TRIM"
            value={output.gainDb}
            min={Mix.OUTPUT_GAIN_MIN_DB}
            max={Mix.OUTPUT_GAIN_MAX_DB}
            step={Mix.OUTPUT_GAIN_STEP_DB}
            kind="dB-signed"
            tone="signed"
            onCommit={(v) => Runtime.setOutputGain(s, slot, v)}
          />
        </div>
        <div class="r">
          <span class="lbl">DELAY</span>
          <span class="ctl fld">
            <ValueField
              kind="ms"
              min={Mix.OUTPUT_DELAY_MIN_MS}
              max={Mix.OUTPUT_DELAY_MAX_MS}
              step={Mix.OUTPUT_DELAY_STEP_MS}
              value={output.delayMs}
              onChange={(v) => Runtime.setOutputDelay(s, slot, v)}
            />
          </span>
        </div>
        <div class="r">
          <span class="lbl">MUTE</span>
          <span class="ctl"><ToggleSwitch size="sm" checked={output.muted} ariaLabel="Mute output" onChange={(v) => Runtime.setOutputMuted(s, slot, v)} /></span>
        </div>
        <div class="r">
          <span class="lbl">ENABLED</span>
          <span class="ctl"><ToggleSwitch size="sm" checked={output.enabled} ariaLabel="Output enabled" onChange={(v) => Runtime.setOutputEnabled(s, slot, v)} /></span>
        </div>
        <div class="r">
          <span class="lbl">TYPE</span>
          <span class="ctl"><span class="mono">{typeLabel}</span></span>
        </div>
      </InspectorSection>
    </div>

    {#if showLimiter && lim}
      <div class="col">
        <InspectorSection title="Limiter">
          <div class="r">
            <span class="lbl">ENABLED</span>
            <span class="ctl"><ToggleSwitch size="sm" checked={lim.enabled} ariaLabel="Limiter" onChange={(v) => Runtime.setLimiterEnabled(s, slot, v)} /></span>
          </div>
          <div class="r">
            <span class="lbl">THRESHOLD</span>
            <span class="ctl fld">
              <ValueField
                kind="dB-signed"
                precision={1}
                min={Proc.LIMITER_THRESHOLD_MIN_DB}
                max={Proc.LIMITER_THRESHOLD_MAX_DB}
                step={Proc.LIMITER_THRESHOLD_STEP_DB}
                value={lim.thresholdDb}
                disabled={!lim.enabled}
                onChange={(v) => Runtime.setLimiterThreshold(s, slot, v)}
              />
            </span>
          </div>
          <div class="r">
            <span class="lbl">RELEASE</span>
            <span class="ctl fld">
              <ValueField
                kind="ms"
                precision={0}
                min={Proc.LIMITER_RELEASE_MIN_MS}
                max={Proc.LIMITER_RELEASE_MAX_MS}
                step={Proc.LIMITER_RELEASE_STEP_MS}
                value={lim.releaseMs}
                disabled={!lim.enabled}
                onChange={(v) => Runtime.setLimiterRelease(s, slot, v)}
              />
            </span>
          </div>
          <div class="r">
            <span class="lbl">LINK</span>
            <span class="ctl"><SegmentedSelect
              size="sm"
              value={lim.linkGroup}
              options={LINK_OPTIONS}
              ariaLabel="Limiter link group"
              onChange={(v) => Runtime.setLimiterLinkGroup(s, slot, v)}
            /></span>
          </div>
          <div class="r">
            <span class="lbl" title="Gain reduction">GR</span>
            <span class="gr">
              <span class="bar" aria-hidden="true">{#if s.telemetry.limiterMeterDb}<span class="fill" style:width="{grPct}%"></span>{/if}</span>
              <span class="mono grv">{grText(gr)}</span>
            </span>
          </div>
        </InspectorSection>
      </div>
    {/if}
  </div>

  {#if showProcs}
    <div class="procs">
      <span class="lbl">Processors</span>
      <span class="chips">
        {#if features.loudnessOutputMask}
          <button type="button" class="chip hi" class:on={inMask(snap?.loudness.outputMask)} aria-pressed={inMask(snap?.loudness.outputMask)}
            disabled={!snap?.loudness.enabled}
            onclick={() => Runtime.toggleLoudnessOutputChannel(s, slot)}>LOUD</button>
        {/if}
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
      <span class="cap">program processors that include this output</span>
    </div>
  {/if}
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
  .col { flex: 0 0 320px; min-width: 0; }
  .col + .col { border-left: 1px solid var(--border); padding-left: 16px; margin-left: 16px; }
  .stage :global(.sec) { border-top: none; }
  .r {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 24px;
    border-top: 1px solid var(--border);
    --rf-label: 84px;
    --rf-value: 72px;
    --rf-track: 140px;
    --rf-track-flex: 0 0 auto;
  }
  .r :global(.rf) { flex: 0 0 auto; gap: 12px; height: 22px; }
  .r :global(.opt) { font-size: 11px; }
  .lbl { flex: 0 0 84px; font-family: var(--font-sans); font-size: 11px; color: var(--text-dim); white-space: nowrap; }
  .ctl { display: flex; align-items: center; gap: 6px; }
  .fld { width: 72px; }
  .mono { font-family: var(--font-mono); font-size: 12px; color: var(--text); }
  .stage :global(.vf[data-size='md']) { height: 22px; font-size: 12px; }
  .gr { display: inline-flex; align-items: center; gap: 8px; }
  .bar { width: 120px; height: 6px; border-radius: 2px; background: var(--wash-strong); overflow: hidden; }
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
  .procs .lbl { flex: 0 0 auto; }
  .cap { font-family: var(--font-sans); font-size: 11px; color: var(--text-faint); white-space: nowrap; }
  .chips { display: inline-flex; gap: 6px; }
  .chip { height: 20px; font-size: 11px; padding: 0 8px; }
</style>
