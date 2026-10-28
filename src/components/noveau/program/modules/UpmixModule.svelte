<script lang="ts">
  import SegmentedSelect from '@/components/chrome/SegmentedSelect.svelte';
  import * as Domain from '@/domain';
  import * as Runtime from '@/runtime';
  import { getSession } from '@/components/sessionContext';
  import ModuleFrame from './ModuleFrame.svelte';
  import SliderField from '@/components/chrome/SliderField.svelte';

  const s = getSession();
  const upmix = $derived(s.mirror.current?.upmix);
  const enabled = $derived(upmix?.enabled ?? false);
  const features = $derived(s.device.capabilities.features);

  const centerMode = $derived(upmix?.centerMode ?? Domain.UpmixCenterMode.Adaptive);
  const surroundMode = $derived(upmix?.surroundMode ?? Domain.UpmixSurroundMode.Adaptive);
  const steeringEditable = $derived(enabled && centerMode === Domain.UpmixCenterMode.Adaptive);
  const surroundEditable = $derived(enabled && surroundMode !== Domain.UpmixSurroundMode.Off);
  const offReason = $derived(enabled ? undefined : 'Upmixer is off — enable it to edit these controls.');
  const steeringReason = $derived(enabled && !steeringEditable ? 'Adaptive steering needs centre mode LOGIC.' : undefined);
  const surroundReason = $derived(enabled && !surroundEditable ? 'Surround mode is OFF.' : undefined);

  const status = $derived(Domain.upmixParkingStatus(enabled, s.telemetry.activeInputChannels, s.telemetry.info?.sampleRateHz ?? null));

  const CENTER_MODE_OPTIONS = $derived([
    ...(features.upmixCenterOff ? [{ value: Domain.UpmixCenterMode.Off, label: 'OFF' }] : []),
    { value: Domain.UpmixCenterMode.Passive, label: 'PASSIVE' },
    { value: Domain.UpmixCenterMode.Adaptive, label: 'LOGIC' },
  ] as ReadonlyArray<{ value: Domain.UpmixCenterMode; label: string }>);

  const SURROUND_MODE_OPTIONS = [
    { value: Domain.UpmixSurroundMode.Off, label: 'OFF' },
    { value: Domain.UpmixSurroundMode.Passive, label: 'PASSIVE' },
    { value: Domain.UpmixSurroundMode.Adaptive, label: 'LOGIC' },
  ] as const satisfies ReadonlyArray<{ value: Domain.UpmixSurroundMode; label: string }>;
</script>

<ModuleFrame
  title="Stereo upmixer"
  pass="inputs · feeds the matrix"
  blurb="Derives centre and surround feeds from a stereo input and offers them as extra matrix sources. Parks on multichannel input or above 48 kHz."
  {enabled}
>
  <div class="prow">
    <span class="prow-lbl">STATUS</span>
    <span class="prow-ctl"><span class="t-value status" class:ok={status === 'active'} title={Domain.upmixParkingText(status)}>{Domain.upmixParkingText(status)}</span></span>
  </div>

  <div class="prow sub"><span>CENTRE</span></div>
  <div class="prow">
    <span class="prow-lbl">MODE</span>
    <span class="prow-ctl"><SegmentedSelect value={centerMode} options={CENTER_MODE_OPTIONS} disabled={!enabled} disabledReason={offReason}
      ariaLabel="Upmix center mode" onChange={(v) => Runtime.setUpmixCenterMode(s, v)} /></span>
  </div>
  <SliderField lane="scrub" label="STRENGTH" ariaLabel="Upmix center strength" value={upmix?.strengthPct ?? 100}
    min={Domain.Proc.UPMIX_STRENGTH_MIN_PCT} max={Domain.Proc.UPMIX_STRENGTH_MAX_PCT} step={Domain.Proc.UPMIX_STRENGTH_STEP_PCT}
    kind="pct" precision={0} disabled={!enabled} disabledReason={offReason} onChange={(v) => Runtime.setUpmixStrength(s, v)} />
  <SliderField lane="scrub" label="WIDTH" ariaLabel="Upmix center width" value={upmix?.centerWidthPct ?? 25}
    min={Domain.Proc.UPMIX_CENTER_WIDTH_MIN_PCT} max={Domain.Proc.UPMIX_CENTER_WIDTH_MAX_PCT} step={Domain.Proc.UPMIX_CENTER_WIDTH_STEP_PCT}
    kind="pct" precision={0} disabled={!enabled} disabledReason={offReason} onChange={(v) => Runtime.setUpmixCenterWidth(s, v)} />
  {#if features.upmixPresence}
    <SliderField lane="scrub" label="PRESENCE" ariaLabel="Upmix center presence" value={upmix?.presenceDb ?? 0}
      min={Domain.Proc.UPMIX_PRESENCE_MIN_DB} max={Domain.Proc.UPMIX_PRESENCE_MAX_DB} step={Domain.Proc.UPMIX_PRESENCE_STEP_DB}
      kind="dB-signed" precision={1} disabled={!enabled} disabledReason={offReason} onChange={(v) => Runtime.setUpmixPresence(s, v)} />
  {/if}
  <SliderField lane="scrub" label="THRESHOLD" ariaLabel="Upmix adaptive-steering threshold" value={upmix?.corrThresholdPct ?? 30}
    min={Domain.Proc.UPMIX_CORR_THRESHOLD_MIN_PCT} max={Domain.Proc.UPMIX_CORR_THRESHOLD_MAX_PCT} step={Domain.Proc.UPMIX_CORR_THRESHOLD_STEP_PCT}
    kind="pct" precision={0} disabled={!steeringEditable} disabledReason={offReason ?? steeringReason} onChange={(v) => Runtime.setUpmixCorrThreshold(s, v)} />
  <SliderField lane="scrub" label="ATTACK" ariaLabel="Upmix adaptive-steering attack time" value={upmix?.attackMs ?? 10}
    min={Domain.Proc.UPMIX_ATTACK_MIN_MS} max={Domain.Proc.UPMIX_ATTACK_MAX_MS} step={Domain.Proc.UPMIX_ATTACK_STEP_MS}
    kind="ms" precision={0} disabled={!steeringEditable} disabledReason={offReason ?? steeringReason} onChange={(v) => Runtime.setUpmixAttack(s, v)} />
  <SliderField lane="scrub" label="RELEASE" ariaLabel="Upmix adaptive-steering release time" value={upmix?.releaseMs ?? 100}
    min={Domain.Proc.UPMIX_RELEASE_MIN_MS} max={Domain.Proc.UPMIX_RELEASE_MAX_MS} step={Domain.Proc.UPMIX_RELEASE_STEP_MS}
    kind="ms" precision={0} disabled={!steeringEditable} disabledReason={offReason ?? steeringReason} onChange={(v) => Runtime.setUpmixRelease(s, v)} />
  <SliderField lane="scrub" label="DET HPF" ariaLabel="Upmix adaptive-steering detector high-pass frequency" value={upmix?.detectorHpfHz ?? 200}
    min={Domain.Proc.UPMIX_DETECTOR_HPF_MIN_HZ} max={Domain.Proc.UPMIX_DETECTOR_HPF_MAX_HZ} step={Domain.Proc.UPMIX_DETECTOR_HPF_STEP_HZ}
    kind="hz" precision={0} disabled={!steeringEditable} disabledReason={offReason ?? steeringReason} onChange={(v) => Runtime.setUpmixDetectorHpf(s, v)} />

  <div class="prow sub"><span>SURROUND</span></div>
  <div class="prow">
    <span class="prow-lbl">MODE</span>
    <span class="prow-ctl"><SegmentedSelect value={surroundMode} options={SURROUND_MODE_OPTIONS} disabled={!enabled} disabledReason={offReason}
      ariaLabel="Upmix surround mode" onChange={(v) => Runtime.setUpmixSurroundMode(s, v)} /></span>
  </div>
  <SliderField lane="scrub" label="DELAY" ariaLabel="Upmix surround delay" value={upmix?.surroundDelayMs ?? 12}
    min={Domain.Proc.UPMIX_SURROUND_DELAY_MIN_MS} max={Domain.Proc.UPMIX_SURROUND_DELAY_MAX_MS} step={Domain.Proc.UPMIX_SURROUND_DELAY_STEP_MS}
    kind="ms" precision={1} disabled={!surroundEditable} disabledReason={offReason ?? surroundReason} onChange={(v) => Runtime.setUpmixSurroundDelay(s, v)} />
  <SliderField lane="scrub" label="HPF" ariaLabel="Upmix surround high-pass frequency" value={upmix?.surroundHpfHz ?? 300}
    min={Domain.Proc.UPMIX_SURROUND_HPF_MIN_HZ} max={Domain.Proc.UPMIX_SURROUND_HPF_MAX_HZ} step={Domain.Proc.UPMIX_SURROUND_HPF_STEP_HZ}
    kind="hz" precision={0} disabled={!surroundEditable} disabledReason={offReason ?? surroundReason} onChange={(v) => Runtime.setUpmixSurroundHpf(s, v)} />
  <SliderField lane="scrub" label="LPF" ariaLabel="Upmix surround low-pass frequency" value={upmix?.surroundLpfHz ?? 7000}
    min={Domain.Proc.UPMIX_SURROUND_LPF_MIN_HZ} max={Domain.Proc.UPMIX_SURROUND_LPF_MAX_HZ} step={Domain.Proc.UPMIX_SURROUND_LPF_STEP_HZ}
    kind="hz" precision={0} disabled={!surroundEditable} disabledReason={offReason ?? surroundReason} onChange={(v) => Runtime.setUpmixSurroundLpf(s, v)} />
  <SliderField lane="scrub" label="DECORR" ariaLabel="Upmix surround decorrelation" value={upmix?.decorrPct ?? 90}
    min={Domain.Proc.UPMIX_DECORR_MIN_PCT} max={Domain.Proc.UPMIX_DECORR_MAX_PCT} step={Domain.Proc.UPMIX_DECORR_STEP_PCT}
    kind="pct" precision={0} disabled={!surroundEditable} disabledReason={offReason ?? surroundReason} onChange={(v) => Runtime.setUpmixDecorr(s, v)} />
</ModuleFrame>

<style>
  .t-value.ok { color: var(--ok); }
  .status { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
