<script lang="ts">
  import * as Domain from '@/domain';
  import * as Runtime from '@/runtime';
  import { getSession } from '@/components/sessionContext';
  import BodePlot, { type BodeCurve } from '@/components/noveau/tune/BodePlot.svelte';
  import ModuleFrame from './ModuleFrame.svelte';
  import SliderField from '@/components/chrome/SliderField.svelte';
  import MaskChips from '@/components/chrome/MaskChips.svelte';

  const s = getSession();
  const loudness = $derived(s.mirror.current?.loudness);
  const enabled = $derived(loudness?.enabled ?? false);
  const offReason = $derived(enabled ? undefined : 'Loudness is off — enable it to edit these controls.');

  const curves = $derived<BodeCurve[]>([
    { id: 'loudness', points: Domain.loudnessResponse(loudness?.refSpl ?? 85, loudness?.intensityPct ?? 0) },
  ]);
  const yRange = $derived(Domain.centeredDbDomain([curves[0].points]));

  // Bit k addresses output slot k (PDM included), not the raw ChannelId.
  const outputChannels = $derived(Domain.outputChannelsWithIndex(s.mirror.current));
  const showMask = $derived(s.device.capabilities.features.loudnessOutputMask && outputChannels.length > 1);
  const outputItems = $derived(Domain.maskChipItems(outputChannels, 'Output'));
</script>

<ModuleFrame
  title="Loudness"
  pass="per output · after trim, before delay"
  blurb="Equal-loudness compensation (ISO 226): boosts bass and treble as the volume goes down. The graph is the correction at the current volume relative to the reference level."
  {enabled}
>
  <BodePlot {curves} height={96} crosshair={false} {yRange} />
  {#if showMask}
    <MaskChips label="OUTPUTS" items={outputItems} mask={loudness?.outputMask ?? 0xFFFF} disabled={!enabled}
      onToggle={(i) => Runtime.toggleLoudnessOutputChannel(s, i)} />
  {/if}
  <SliderField lane="scrub" label="REF SPL" ariaLabel="Loudness reference SPL" value={loudness?.refSpl ?? 85}
    min={Domain.Proc.LOUDNESS_REF_SPL_MIN_DB} max={Domain.Proc.LOUDNESS_REF_SPL_MAX_DB} step={Domain.Proc.LOUDNESS_REF_SPL_STEP_DB}
    kind="dB" precision={0} disabled={!enabled} disabledReason={offReason} onChange={(v) => Runtime.setLoudnessRefSpl(s, v)} />
  <SliderField lane="scrub" label="INTENSITY" ariaLabel="Loudness intensity" value={loudness?.intensityPct ?? 0}
    min={Domain.Proc.LOUDNESS_INTENSITY_MIN_PCT} max={Domain.Proc.LOUDNESS_INTENSITY_MAX_PCT} step={Domain.Proc.LOUDNESS_INTENSITY_STEP_PCT}
    kind="pct" precision={1} disabled={!enabled} disabledReason={offReason} onChange={(v) => Runtime.setLoudnessIntensityPct(s, v)} />
</ModuleFrame>
