<script lang="ts">
  import { Proc, outputChannelsWithIndex, maskChipItems } from '@/domain';
  import * as Runtime from '@/runtime';
  import { getSession } from '@/components/sessionContext';
  import BodePlot, { type BodeCurve } from '@/components/bode/BodePlot.svelte';
  import { loudnessResponse } from '@/components/bode/loudnessCurve';
  import { centeredDbDomain } from '@/components/bode/dbDomain';
  import ModuleFrame from './ModuleFrame.svelte';
  import ModuleSlider from './ModuleSlider.svelte';
  import MaskChips from './MaskChips.svelte';

  const s = getSession();
  const loudness = $derived(s.mirror.current?.loudness);
  const enabled = $derived(loudness?.enabled ?? false);

  const curves = $derived<BodeCurve[]>([
    { id: 'loudness', points: loudnessResponse(loudness?.refSpl ?? 85, loudness?.intensityPct ?? 0) },
  ]);
  const yRange = $derived(centeredDbDomain([curves[0].points]));

  // Bit k addresses output slot k (PDM included), not the raw ChannelId.
  const outputChannels = $derived(outputChannelsWithIndex(s.mirror.current));
  const showMask = $derived(s.device.capabilities.features.loudnessOutputMask && outputChannels.length > 1);
  const outputItems = $derived(maskChipItems(outputChannels, 'Output'));
</script>

<ModuleFrame
  title="Loudness"
  pass="per output · after trim, before delay"
  blurb="Equal-loudness compensation (ISO 226): boosts bass and treble as the volume goes down. The graph is the correction at the current volume relative to the reference level."
  {enabled}
>
  <div class:dim={!enabled}><BodePlot {curves} height={96} crosshair={false} {yRange} /></div>
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

<style>
  .dim { opacity: var(--dim-off); }
</style>
