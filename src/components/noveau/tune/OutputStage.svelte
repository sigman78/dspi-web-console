<script lang="ts">
  import { untrack } from 'svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import ValueField from '@/components/chrome/ValueField.svelte';
  import SegmentedSelect from '@/components/chrome/SegmentedSelect.svelte';
  import { ChannelId, Mix, OutputSlotType, Proc, slotForOutputChannel, type OutputModel } from '@/domain';
  import * as Runtime from '@/runtime';
  import { getSession } from '@/components/sessionContext';
  import RangeField from './RangeField.svelte';

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
  <div class="line">
    <div class="trim">
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
    <span class="f">
      <span class="lbl">DELAY</span>
      <span class="fld">
        <ValueField
          kind="ms"
          min={Mix.OUTPUT_DELAY_MIN_MS}
          max={Mix.OUTPUT_DELAY_MAX_MS}
          step={Mix.OUTPUT_DELAY_STEP_MS}
          value={output.delayMs}
          onChange={(v) => Runtime.setOutputDelay(s, slot, v)}
        />
      </span>
    </span>
    <span class="f">
      <span class="lbl">MUTE</span>
      <ToggleSwitch size="sm" checked={output.muted} ariaLabel="Mute output" onChange={(v) => Runtime.setOutputMuted(s, slot, v)} />
    </span>
    <span class="f">
      <span class="lbl">ENABLED</span>
      <ToggleSwitch size="sm" checked={output.enabled} ariaLabel="Output enabled" onChange={(v) => Runtime.setOutputEnabled(s, slot, v)} />
    </span>
    <span class="f right">
      <span class="lbl">TYPE</span>
      <span class="mono">{typeLabel}</span>
    </span>
  </div>

  <div class="line">
    {#if features.limiter && lim}
      <span class="f">
        <span class="lbl">LIMITER</span>
        <ToggleSwitch size="sm" checked={lim.enabled} ariaLabel="Limiter" onChange={(v) => Runtime.setLimiterEnabled(s, slot, v)} />
      </span>
      <span class="f">
        <span class="lbl">THRESH</span>
        <span class="fld sm">
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
      </span>
      <span class="f">
        <span class="lbl">RELEASE</span>
        <span class="fld sm">
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
      </span>
      <span class="f">
        <span class="lbl">LINK</span>
        <SegmentedSelect
          size="sm"
          value={lim.linkGroup}
          options={LINK_OPTIONS}
          ariaLabel="Limiter link group"
          onChange={(v) => Runtime.setLimiterLinkGroup(s, slot, v)}
        />
      </span>
      <span class="f grow">
        <span class="lbl">GR</span>
        <span class="bar" aria-hidden="true">{#if s.telemetry.limiterMeterDb}<span class="fill" style:width="{grPct}%"></span>{/if}</span>
        <span class="mono grv">{grText(gr)}</span>
      </span>
    {:else}
      <span class="grow"></span>
    {/if}
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
  </div>
</div>

<style>
  .stage {
    display: grid;
    grid-template-rows: 32px 32px;
    border-top: 1px solid var(--border);
    min-width: 0;
  }
  .line { display: flex; align-items: center; gap: 16px; min-width: 0; overflow: hidden; }
  .trim { flex: 0 0 280px; --rf-label: 40px; --rf-value: 84px; }
  .f { display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
  .f.grow { flex: 1; min-width: 0; }
  .f.right { margin-left: auto; }
  .grow { flex: 1; }
  .lbl { font-family: var(--font-sans); font-size: 11px; color: var(--text-dim); }
  .fld { width: 78px; }
  .fld.sm { width: 70px; }
  .mono { font-family: var(--font-mono); font-size: 12px; color: var(--text); }
  .stage :global(.vf) { font-size: 12px; }
  .bar { flex: 1; min-width: 40px; max-width: 120px; height: 6px; border-radius: 2px; background: var(--wash-strong); overflow: hidden; }
  .fill { display: block; height: 100%; background: var(--warn); transition: width 100ms; }
  .grv { min-width: 56px; }
  .chips { display: inline-flex; gap: 6px; margin-left: auto; }
  .chip { height: 20px; font-size: 11px; padding: 0 8px; }
</style>
