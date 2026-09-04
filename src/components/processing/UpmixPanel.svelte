<script lang="ts">
  import ProcPanel from './ProcPanel.svelte';
  import LabeledSlider from '@/components/chrome/LabeledSlider.svelte';
  import SegmentedSelect from '@/components/chrome/SegmentedSelect.svelte';
  import { connection } from '@/state';
  import { Proc, UpmixCenterMode, UpmixSurroundMode } from '@/domain';
  import {
    setUpmixEnabled, setUpmixCenterMode, setUpmixSurroundMode,
    setUpmixStrength, setUpmixCenterWidth, setUpmixPresence,
    setUpmixCorrThreshold, setUpmixAttack, setUpmixRelease, setUpmixDetectorHpf,
    setUpmixSurroundDelay, setUpmixSurroundHpf, setUpmixSurroundLpf, setUpmixDecorr,
  } from '@/runtime';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();

  const upmix = $derived(s.mirror.current?.upmix);
  const connected = $derived(connection.connected);
  const enabled = $derived(upmix?.enabled ?? false);
  const editable = $derived(connected && enabled);
  const showPresence = $derived(s.device.capabilities.features.upmixPresence);
  const showCenterOff = $derived(s.device.capabilities.features.upmixCenterOff);

  const centerMode = $derived(upmix?.centerMode ?? UpmixCenterMode.Adaptive);
  const surroundMode = $derived(upmix?.surroundMode ?? UpmixSurroundMode.Adaptive);
  const centerSteeringEditable = $derived(editable && centerMode === UpmixCenterMode.Adaptive);
  const surroundEditable = $derived(editable && surroundMode !== UpmixSurroundMode.Off);

  // Status line, derived client-side (no extra polling): mirrors the fw's own
  // GetUpmixStatus parked-reason logic (Disabled/NotStereoInput/RateAbove48k)
  // from signals the console already tracks -- the live input channel count
  // (shared with the leveller masks/mixer row count) and FS from the header's
  // own status poll.
  const activeInputChannels = $derived(s.telemetry.activeInputChannels);
  const sampleRateHz = $derived(s.telemetry.info?.sampleRateHz ?? null);
  const parkedReason = $derived(
    !enabled ? 'disabled'
    : activeInputChannels != null && activeInputChannels !== 2 ? 'input not stereo'
    : sampleRateHz != null && sampleRateHz > 48000 ? 'rate > 48 kHz'
    : null
  );
  const statusText = $derived(parkedReason === null ? 'ACTIVE' : `PARKED — ${parkedReason}`);

  // OFF (V27+, capability-gated) leads the row, mirroring the surround row's
  // OFF-first order below -- chips bind by value, so this is purely visual.
  const CENTER_MODE_OPTIONS = $derived([
    ...(showCenterOff ? [{ value: UpmixCenterMode.Off, label: 'OFF' }] : []),
    { value: UpmixCenterMode.Passive,  label: 'PASSIVE' },
    { value: UpmixCenterMode.Adaptive, label: 'LOGIC'   },
  ] as ReadonlyArray<{ value: UpmixCenterMode; label: string }>);

  const SURROUND_MODE_OPTIONS = [
    { value: UpmixSurroundMode.Off,      label: 'OFF'     },
    { value: UpmixSurroundMode.Passive,  label: 'PASSIVE' },
    { value: UpmixSurroundMode.Adaptive, label: 'LOGIC'   },
  ] as const satisfies ReadonlyArray<{ value: UpmixSurroundMode; label: string }>;
</script>

<ProcPanel
  code="PR.05"
  title="STEREO UPMIXER"
  subject="stereo upmixer"
  {enabled}
  {connected}
  onToggle={() => upmix && setUpmixEnabled(s, !upmix.enabled)}
>
  <p class="hint status" class:active={parkedReason === null}>{statusText}</p>

  <div class="proc-grid">
    <span class="section">CENTRE</span>

    <span class="microlbl">MODE</span>
    <div class="span2">
      <SegmentedSelect
        value={centerMode}
        options={CENTER_MODE_OPTIONS}
        disabled={!editable}
        ariaLabel="Upmix center mode"
        onChange={(v) => setUpmixCenterMode(s, v)}
      />
    </div>

    <LabeledSlider
      label="STRENGTH"
      ariaLabel="Upmix center strength"
      value={upmix?.strengthPct ?? 100}
      min={Proc.UPMIX_STRENGTH_MIN_PCT} max={Proc.UPMIX_STRENGTH_MAX_PCT} step={Proc.UPMIX_STRENGTH_STEP_PCT}
      kind="pct"
      precision={0}
      disabled={!editable}
      onChange={(v) => setUpmixStrength(s, v)}
    />

    <LabeledSlider
      label="WIDTH"
      ariaLabel="Upmix center width"
      value={upmix?.centerWidthPct ?? 25}
      min={Proc.UPMIX_CENTER_WIDTH_MIN_PCT} max={Proc.UPMIX_CENTER_WIDTH_MAX_PCT} step={Proc.UPMIX_CENTER_WIDTH_STEP_PCT}
      kind="pct"
      precision={0}
      disabled={!editable}
      onChange={(v) => setUpmixCenterWidth(s, v)}
    />

    {#if showPresence}
      <LabeledSlider
        label="PRESENCE"
        ariaLabel="Upmix center presence"
        value={upmix?.presenceDb ?? 0}
        min={Proc.UPMIX_PRESENCE_MIN_DB} max={Proc.UPMIX_PRESENCE_MAX_DB} step={Proc.UPMIX_PRESENCE_STEP_DB}
        kind="dB-signed"
        precision={1}
        disabled={!editable}
        onChange={(v) => setUpmixPresence(s, v)}
      />
    {/if}

    <LabeledSlider
      label="THRESHOLD"
      ariaLabel="Upmix adaptive-steering threshold"
      value={upmix?.corrThresholdPct ?? 30}
      min={Proc.UPMIX_CORR_THRESHOLD_MIN_PCT} max={Proc.UPMIX_CORR_THRESHOLD_MAX_PCT} step={Proc.UPMIX_CORR_THRESHOLD_STEP_PCT}
      kind="pct"
      precision={0}
      disabled={!centerSteeringEditable}
      onChange={(v) => setUpmixCorrThreshold(s, v)}
    />

    <LabeledSlider
      label="ATTACK"
      ariaLabel="Upmix adaptive-steering attack time"
      value={upmix?.attackMs ?? 10}
      min={Proc.UPMIX_ATTACK_MIN_MS} max={Proc.UPMIX_ATTACK_MAX_MS} step={Proc.UPMIX_ATTACK_STEP_MS}
      kind="ms"
      precision={0}
      disabled={!centerSteeringEditable}
      onChange={(v) => setUpmixAttack(s, v)}
    />

    <LabeledSlider
      label="RELEASE"
      ariaLabel="Upmix adaptive-steering release time"
      value={upmix?.releaseMs ?? 100}
      min={Proc.UPMIX_RELEASE_MIN_MS} max={Proc.UPMIX_RELEASE_MAX_MS} step={Proc.UPMIX_RELEASE_STEP_MS}
      kind="ms"
      precision={0}
      disabled={!centerSteeringEditable}
      onChange={(v) => setUpmixRelease(s, v)}
    />

    <LabeledSlider
      label="DET HPF"
      ariaLabel="Upmix adaptive-steering detector high-pass frequency"
      value={upmix?.detectorHpfHz ?? 200}
      min={Proc.UPMIX_DETECTOR_HPF_MIN_HZ} max={Proc.UPMIX_DETECTOR_HPF_MAX_HZ} step={Proc.UPMIX_DETECTOR_HPF_STEP_HZ}
      kind="hz"
      precision={0}
      disabled={!centerSteeringEditable}
      onChange={(v) => setUpmixDetectorHpf(s, v)}
    />

    <div class="rule"></div>
    <span class="section">SURROUND</span>

    <span class="microlbl">MODE</span>
    <div class="span2">
      <SegmentedSelect
        value={surroundMode}
        options={SURROUND_MODE_OPTIONS}
        disabled={!editable}
        ariaLabel="Upmix surround mode"
        onChange={(v) => setUpmixSurroundMode(s, v)}
      />
    </div>

    <LabeledSlider
      label="DELAY"
      ariaLabel="Upmix surround delay"
      value={upmix?.surroundDelayMs ?? 12}
      min={Proc.UPMIX_SURROUND_DELAY_MIN_MS} max={Proc.UPMIX_SURROUND_DELAY_MAX_MS} step={Proc.UPMIX_SURROUND_DELAY_STEP_MS}
      kind="ms"
      precision={1}
      disabled={!surroundEditable}
      onChange={(v) => setUpmixSurroundDelay(s, v)}
    />

    <LabeledSlider
      label="HPF"
      ariaLabel="Upmix surround high-pass frequency"
      value={upmix?.surroundHpfHz ?? 300}
      min={Proc.UPMIX_SURROUND_HPF_MIN_HZ} max={Proc.UPMIX_SURROUND_HPF_MAX_HZ} step={Proc.UPMIX_SURROUND_HPF_STEP_HZ}
      kind="hz"
      precision={0}
      disabled={!surroundEditable}
      onChange={(v) => setUpmixSurroundHpf(s, v)}
    />

    <LabeledSlider
      label="LPF"
      ariaLabel="Upmix surround low-pass frequency"
      value={upmix?.surroundLpfHz ?? 7000}
      min={Proc.UPMIX_SURROUND_LPF_MIN_HZ} max={Proc.UPMIX_SURROUND_LPF_MAX_HZ} step={Proc.UPMIX_SURROUND_LPF_STEP_HZ}
      kind="hz"
      precision={0}
      disabled={!surroundEditable}
      onChange={(v) => setUpmixSurroundLpf(s, v)}
    />

    <LabeledSlider
      label="DECORR"
      ariaLabel="Upmix surround decorrelation"
      value={upmix?.decorrPct ?? 90}
      min={Proc.UPMIX_DECORR_MIN_PCT} max={Proc.UPMIX_DECORR_MAX_PCT} step={Proc.UPMIX_DECORR_STEP_PCT}
      kind="pct"
      precision={0}
      disabled={!surroundEditable}
      onChange={(v) => setUpmixDecorr(s, v)}
    />
  </div>
</ProcPanel>

<style>
  .status {
    padding: 8px 14px 0;
  }
  .status.active { color: var(--ok); }
  .section {
    grid-column: 1 / -1;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1.5px;
    color: var(--text-faint);
  }
</style>
