<script lang="ts">
  import SegmentedSelect from '@/components/chrome/SegmentedSelect.svelte';
  import { Proc, UpmixCenterMode, UpmixSurroundMode } from '@/domain';
  import * as Runtime from '@/runtime';
  import { getSession } from '@/components/sessionContext';
  import { upmixStatus, upmixStatusText } from '../upmixStatus';
  import ModuleFrame from './ModuleFrame.svelte';
  import ModuleSlider from './ModuleSlider.svelte';

  const s = getSession();
  const upmix = $derived(s.mirror.current?.upmix);
  const enabled = $derived(upmix?.enabled ?? false);
  const features = $derived(s.device.capabilities.features);

  const centerMode = $derived(upmix?.centerMode ?? UpmixCenterMode.Adaptive);
  const surroundMode = $derived(upmix?.surroundMode ?? UpmixSurroundMode.Adaptive);
  const steeringEditable = $derived(enabled && centerMode === UpmixCenterMode.Adaptive);
  const surroundEditable = $derived(enabled && surroundMode !== UpmixSurroundMode.Off);

  const status = $derived(upmixStatus(enabled, s.telemetry.activeInputChannels, s.telemetry.info?.sampleRateHz ?? null));

  const CENTER_MODE_OPTIONS = $derived([
    ...(features.upmixCenterOff ? [{ value: UpmixCenterMode.Off, label: 'OFF' }] : []),
    { value: UpmixCenterMode.Passive, label: 'PASSIVE' },
    { value: UpmixCenterMode.Adaptive, label: 'LOGIC' },
  ] as ReadonlyArray<{ value: UpmixCenterMode; label: string }>);

  const SURROUND_MODE_OPTIONS = [
    { value: UpmixSurroundMode.Off, label: 'OFF' },
    { value: UpmixSurroundMode.Passive, label: 'PASSIVE' },
    { value: UpmixSurroundMode.Adaptive, label: 'LOGIC' },
  ] as const satisfies ReadonlyArray<{ value: UpmixSurroundMode; label: string }>;
</script>

<ModuleFrame
  title="Stereo upmixer"
  pass="program processor"
  {enabled}
>
  <div class="r">
    <span class="lbl">STATUS</span>
    <span class="ctl"><span class="mono" class:ok={status === 'active'}>{upmixStatusText(status)}</span></span>
  </div>

  <div class="r sub"><span>CENTRE</span></div>
  <div class="r">
    <span class="lbl">MODE</span>
    <span class="ctl"><SegmentedSelect size="sm" value={centerMode} options={CENTER_MODE_OPTIONS} disabled={!enabled}
      ariaLabel="Upmix center mode" onChange={(v) => Runtime.setUpmixCenterMode(s, v)} /></span>
  </div>
  <ModuleSlider label="STRENGTH" ariaLabel="Upmix center strength" value={upmix?.strengthPct ?? 100}
    min={Proc.UPMIX_STRENGTH_MIN_PCT} max={Proc.UPMIX_STRENGTH_MAX_PCT} step={Proc.UPMIX_STRENGTH_STEP_PCT}
    kind="pct" precision={0} disabled={!enabled} onChange={(v) => Runtime.setUpmixStrength(s, v)} />
  <ModuleSlider label="WIDTH" ariaLabel="Upmix center width" value={upmix?.centerWidthPct ?? 25}
    min={Proc.UPMIX_CENTER_WIDTH_MIN_PCT} max={Proc.UPMIX_CENTER_WIDTH_MAX_PCT} step={Proc.UPMIX_CENTER_WIDTH_STEP_PCT}
    kind="pct" precision={0} disabled={!enabled} onChange={(v) => Runtime.setUpmixCenterWidth(s, v)} />
  {#if features.upmixPresence}
    <ModuleSlider label="PRESENCE" ariaLabel="Upmix center presence" value={upmix?.presenceDb ?? 0}
      min={Proc.UPMIX_PRESENCE_MIN_DB} max={Proc.UPMIX_PRESENCE_MAX_DB} step={Proc.UPMIX_PRESENCE_STEP_DB}
      kind="dB-signed" precision={1} disabled={!enabled} onChange={(v) => Runtime.setUpmixPresence(s, v)} />
  {/if}
  <ModuleSlider label="THRESHOLD" ariaLabel="Upmix adaptive-steering threshold" value={upmix?.corrThresholdPct ?? 30}
    min={Proc.UPMIX_CORR_THRESHOLD_MIN_PCT} max={Proc.UPMIX_CORR_THRESHOLD_MAX_PCT} step={Proc.UPMIX_CORR_THRESHOLD_STEP_PCT}
    kind="pct" precision={0} disabled={!steeringEditable} onChange={(v) => Runtime.setUpmixCorrThreshold(s, v)} />
  <ModuleSlider label="ATTACK" ariaLabel="Upmix adaptive-steering attack time" value={upmix?.attackMs ?? 10}
    min={Proc.UPMIX_ATTACK_MIN_MS} max={Proc.UPMIX_ATTACK_MAX_MS} step={Proc.UPMIX_ATTACK_STEP_MS}
    kind="ms" precision={0} disabled={!steeringEditable} onChange={(v) => Runtime.setUpmixAttack(s, v)} />
  <ModuleSlider label="RELEASE" ariaLabel="Upmix adaptive-steering release time" value={upmix?.releaseMs ?? 100}
    min={Proc.UPMIX_RELEASE_MIN_MS} max={Proc.UPMIX_RELEASE_MAX_MS} step={Proc.UPMIX_RELEASE_STEP_MS}
    kind="ms" precision={0} disabled={!steeringEditable} onChange={(v) => Runtime.setUpmixRelease(s, v)} />
  <ModuleSlider label="DET HPF" ariaLabel="Upmix adaptive-steering detector high-pass frequency" value={upmix?.detectorHpfHz ?? 200}
    min={Proc.UPMIX_DETECTOR_HPF_MIN_HZ} max={Proc.UPMIX_DETECTOR_HPF_MAX_HZ} step={Proc.UPMIX_DETECTOR_HPF_STEP_HZ}
    kind="hz" precision={0} disabled={!steeringEditable} onChange={(v) => Runtime.setUpmixDetectorHpf(s, v)} />

  <div class="r sub"><span>SURROUND</span></div>
  <div class="r">
    <span class="lbl">MODE</span>
    <span class="ctl"><SegmentedSelect size="sm" value={surroundMode} options={SURROUND_MODE_OPTIONS} disabled={!enabled}
      ariaLabel="Upmix surround mode" onChange={(v) => Runtime.setUpmixSurroundMode(s, v)} /></span>
  </div>
  <ModuleSlider label="DELAY" ariaLabel="Upmix surround delay" value={upmix?.surroundDelayMs ?? 12}
    min={Proc.UPMIX_SURROUND_DELAY_MIN_MS} max={Proc.UPMIX_SURROUND_DELAY_MAX_MS} step={Proc.UPMIX_SURROUND_DELAY_STEP_MS}
    kind="ms" precision={1} disabled={!surroundEditable} onChange={(v) => Runtime.setUpmixSurroundDelay(s, v)} />
  <ModuleSlider label="HPF" ariaLabel="Upmix surround high-pass frequency" value={upmix?.surroundHpfHz ?? 300}
    min={Proc.UPMIX_SURROUND_HPF_MIN_HZ} max={Proc.UPMIX_SURROUND_HPF_MAX_HZ} step={Proc.UPMIX_SURROUND_HPF_STEP_HZ}
    kind="hz" precision={0} disabled={!surroundEditable} onChange={(v) => Runtime.setUpmixSurroundHpf(s, v)} />
  <ModuleSlider label="LPF" ariaLabel="Upmix surround low-pass frequency" value={upmix?.surroundLpfHz ?? 7000}
    min={Proc.UPMIX_SURROUND_LPF_MIN_HZ} max={Proc.UPMIX_SURROUND_LPF_MAX_HZ} step={Proc.UPMIX_SURROUND_LPF_STEP_HZ}
    kind="hz" precision={0} disabled={!surroundEditable} onChange={(v) => Runtime.setUpmixSurroundLpf(s, v)} />
  <ModuleSlider label="DECORR" ariaLabel="Upmix surround decorrelation" value={upmix?.decorrPct ?? 90}
    min={Proc.UPMIX_DECORR_MIN_PCT} max={Proc.UPMIX_DECORR_MAX_PCT} step={Proc.UPMIX_DECORR_STEP_PCT}
    kind="pct" precision={0} disabled={!surroundEditable} onChange={(v) => Runtime.setUpmixDecorr(s, v)} />
</ModuleFrame>

<style>
  .mono.ok { color: var(--ok); }
</style>
