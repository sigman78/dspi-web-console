<script lang="ts">
  import { Proc, outputChannelsWithIndex, maskChipItems } from '@/domain';
  import * as Runtime from '@/runtime';
  import { getSession } from '@/components/sessionContext';
  import ModuleFrame from './ModuleFrame.svelte';
  import ModuleSlider from './ModuleSlider.svelte';
  import MaskChips from './MaskChips.svelte';

  const s = getSession();
  const loudness = $derived(s.mirror.current?.loudness);
  const enabled = $derived(loudness?.enabled ?? false);

  // Bit k addresses output slot k (PDM included), not the raw ChannelId.
  const outputChannels = $derived(outputChannelsWithIndex(s.mirror.current));
  const showMask = $derived(s.device.capabilities.features.loudnessOutputMask && outputChannels.length > 1);
  const outputItems = $derived(maskChipItems(outputChannels, 'Output'));
</script>

<ModuleFrame
  title="Loudness"
  pass="program · before matrix"
  {enabled}
  onToggle={(v) => Runtime.setLoudnessEnabled(s, v)}
>
  {#if showMask}
    <MaskChips label="OUTPUTS" items={outputItems} mask={loudness?.outputMask ?? 0xFFFF} disabled={!enabled}
      onToggle={(i) => Runtime.toggleLoudnessOutputChannel(s, i)} />
  {/if}
  <ModuleSlider label="REF SPL" ariaLabel="Loudness reference SPL" value={loudness?.refSpl ?? 85}
    min={Proc.LOUDNESS_REF_SPL_MIN_DB} max={Proc.LOUDNESS_REF_SPL_MAX_DB} step={Proc.LOUDNESS_REF_SPL_STEP_DB}
    kind="dB" precision={0} disabled={!enabled} onChange={(v) => Runtime.setLoudnessRefSpl(s, v)} />
  <ModuleSlider label="INTENSITY" ariaLabel="Loudness intensity" value={loudness?.intensityPct ?? 0}
    min={Proc.LOUDNESS_INTENSITY_MIN_PCT} max={Proc.LOUDNESS_INTENSITY_MAX_PCT} step={Proc.LOUDNESS_INTENSITY_STEP_PCT}
    kind="pct" precision={1} disabled={!enabled} onChange={(v) => Runtime.setLoudnessIntensityPct(s, v)} />
</ModuleFrame>
