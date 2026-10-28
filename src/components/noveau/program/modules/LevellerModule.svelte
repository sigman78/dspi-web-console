<script lang="ts">
  import SegmentedSelect from '@/components/chrome/SegmentedSelect.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import { LevellerSpeed, Proc, inputIndexOf, maskChipItems } from '@/domain';
  import * as Runtime from '@/runtime';
  import { getSession } from '@/components/sessionContext';
  import ModuleFrame from './ModuleFrame.svelte';
  import SliderField from '@/components/chrome/SliderField.svelte';
  import MaskChips from '@/components/chrome/MaskChips.svelte';

  const s = getSession();
  const lv = $derived(s.mirror.current?.leveller);
  const enabled = $derived(lv?.enabled ?? false);
  const offReason = $derived(enabled ? undefined : 'Leveller is off — enable it to edit these controls.');

  const SPEED_OPTIONS = [
    { value: LevellerSpeed.Slow, label: 'SLOW' },
    { value: LevellerSpeed.Medium, label: 'MED' },
    { value: LevellerSpeed.Fast, label: 'FAST' },
  ] as const satisfies ReadonlyArray<{ value: LevellerSpeed; label: string }>;

  // Mask bytes are meaningless with a stereo-only input.
  const inputChannels = $derived(
    (s.mirror.current?.channels ?? [])
      .filter((c) => !c.isOutput)
      .map((c) => ({ id: c.id, name: c.name, index: inputIndexOf(c.id) ?? 0 }))
      .sort((a, b) => a.index - b.index),
  );
  const activeCount = $derived(s.telemetry.activeInputChannels ?? inputChannels.length);
  const channelCount = $derived(Math.min(Math.max(activeCount, 2), inputChannels.length || 2));
  const showMasks = $derived(inputChannels.length > 2 && channelCount > 2);
  const channelItems = $derived(maskChipItems(inputChannels.slice(0, channelCount), 'Input'));

  const MASK_PRESETS = [
    { label: 'ALL', title: 'All channels (night mode)', detector: 0xFF, apply: 0xFF },
    { label: 'L·R', title: 'Front L/R only', detector: 0x03, apply: 0x03 },
    { label: 'CTR', title: 'Center only (dialog boost)', detector: 0x04, apply: 0x04 },
  ] as const;
</script>

<ModuleFrame
  title="Leveller"
  pass="inputs · before matrix"
  blurb="Upward RMS compressor: lifts quiet passages toward a target without touching loud ones. Speed sets how fast gain follows the music."
  {enabled}
>
  {#if showMasks}
    <div class="prow">
      <span class="prow-lbl">CHANNELS</span>
      <span class="prow-ctl">
        {#each MASK_PRESETS as p (p.label)}
          <button type="button" class="chip hi" disabled={!enabled} title={p.title}
            onclick={() => Runtime.setLevellerMasks(s, p.detector, p.apply)}>{p.label}</button>
        {/each}
      </span>
    </div>
    <MaskChips label="DETECTOR" items={channelItems} mask={lv?.detectorMask ?? 0xFF} disabled={!enabled}
      onToggle={(i) => Runtime.toggleLevellerDetectorChannel(s, i)} />
    <MaskChips label="APPLY" items={channelItems} mask={lv?.applyMask ?? 0xFF} disabled={!enabled}
      onToggle={(i) => Runtime.toggleLevellerApplyChannel(s, i)} />
  {/if}

  <div class="prow">
    <span class="prow-lbl">SPEED</span>
    <span class="prow-ctl"><SegmentedSelect value={lv?.speed ?? LevellerSpeed.Medium} options={SPEED_OPTIONS}
      disabled={!enabled} disabledReason={offReason} ariaLabel="Leveller speed" onChange={(v) => Runtime.setLevellerSpeed(s, v)} /></span>
  </div>
  <SliderField lane="scrub" label="AMOUNT" ariaLabel="Leveller amount" value={lv?.amount ?? 0}
    min={Proc.LEVELLER_AMOUNT_MIN_PCT} max={Proc.LEVELLER_AMOUNT_MAX_PCT} step={Proc.LEVELLER_AMOUNT_STEP_PCT}
    kind="pct" precision={0} disabled={!enabled} disabledReason={offReason} onChange={(v) => Runtime.setLevellerAmount(s, v)} />
  <SliderField lane="scrub" label="MAX GAIN" ariaLabel="Leveller max gain" value={lv?.maxGainDb ?? 0}
    min={Proc.LEVELLER_MAX_GAIN_MIN_DB} max={Proc.LEVELLER_MAX_GAIN_MAX_DB} step={Proc.LEVELLER_MAX_GAIN_STEP_DB}
    kind="dB" precision={1} disabled={!enabled} disabledReason={offReason} onChange={(v) => Runtime.setLevellerMaxGain(s, v)} />
  <SliderField lane="scrub" label="GATE" ariaLabel="Leveller gate threshold" value={lv?.gateDb ?? -40}
    min={Proc.LEVELLER_GATE_MIN_DB} max={Proc.LEVELLER_GATE_MAX_DB} step={Proc.LEVELLER_GATE_STEP_DB}
    kind="dB" precision={0} disabled={!enabled} disabledReason={offReason} onChange={(v) => Runtime.setLevellerGate(s, v)} />
  <div class="prow">
    <span class="prow-lbl">LOOKAHEAD</span>
    <span class="prow-ctl"><ToggleSwitch checked={lv?.lookahead ?? false} disabled={!enabled} disabledReason={offReason}
      ariaLabel="Leveller lookahead" onChange={(v) => Runtime.setLevellerLookahead(s, v)} /></span>
  </div>
</ModuleFrame>
