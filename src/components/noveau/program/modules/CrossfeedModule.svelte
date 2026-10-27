<script lang="ts">
  import SegmentedSelect from '@/components/chrome/SegmentedSelect.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import { CrossfeedPreset, Proc, outputChannelsWithIndex, crossfeedResponse, centeredDbDomain } from '@/domain';
  import * as Runtime from '@/runtime';
  import { getSession } from '@/components/sessionContext';
  import BodePlot, { type BodeCurve } from '@/components/bode/BodePlot.svelte';
  import ModuleFrame from './ModuleFrame.svelte';
  import SliderField from '@/components/chrome/SliderField.svelte';
  import MaskChips from '@/components/chrome/MaskChips.svelte';

  const s = getSession();
  const cf = $derived(s.mirror.current?.crossfeed);
  const enabled = $derived(cf?.enabled ?? false);
  const isCustom = $derived((cf?.preset ?? CrossfeedPreset.Preset1) === CrossfeedPreset.Custom);
  const slidersEditable = $derived(enabled && isCustom);
  const offReason = $derived(enabled ? undefined : 'Crossfeed is off — enable it to edit these controls.');
  const presetReason = $derived(enabled && !isCustom ? 'The preset fixes cutoff and feed — choose CUSTOM to edit them.' : undefined);
  const reason = $derived(offReason ?? presetReason);

  // Pair p covers output slots 2p and 2p+1; the mono PDM sub never forms a pair.
  const outputChannels = $derived(outputChannelsWithIndex(s.mirror.current));
  const nameByIndex = $derived(new Map<number, string>(outputChannels.map((ch) => [ch.index, ch.name])));
  const pairCount = $derived(Math.min(4, Math.floor(outputChannels.length / 2)));
  const showPairs = $derived(s.device.capabilities.features.crossfeedPairMask && pairCount > 1);
  const pairItems = $derived(
    Array.from({ length: pairCount }, (_, p) => {
      const n0 = nameByIndex.get(2 * p);
      const n1 = nameByIndex.get(2 * p + 1);
      return {
        key: p,
        index: p,
        label: `${2 * p + 1}·${2 * p + 2}`,
        title: n0 && n1 ? `${n0} / ${n1}` : `Outputs ${2 * p + 1}/${2 * p + 2}`,
      };
    }),
  );

  const resp = $derived(crossfeedResponse(cf?.freq ?? 700, cf?.feedDb ?? 4.5));
  const curves = $derived<BodeCurve[]>([
    { id: 'xfeed-direct', points: resp.direct, color: 'color-mix(in oklab, var(--text) 45%, transparent)', label: 'Direct' },
    { id: 'xfeed-cross', points: resp.crossfeed, color: 'var(--accent)', label: 'Crossfeed' },
  ]);
  const yRange = $derived(centeredDbDomain([resp.crossfeed, resp.direct]));

  const PRESET_OPTIONS = [
    { value: CrossfeedPreset.Preset1, label: 'PRESET 1' },
    { value: CrossfeedPreset.Preset2, label: 'PRESET 2' },
    { value: CrossfeedPreset.Preset3, label: 'PRESET 3' },
    { value: CrossfeedPreset.Custom, label: 'CUSTOM' },
  ] as const satisfies ReadonlyArray<{ value: CrossfeedPreset; label: string }>;
</script>

<ModuleFrame
  title="Crossfeed"
  pass="per output pair · after matrix"
  blurb="Headphone crossfeed (BS2B): bleeds a filtered, delayed part of each channel into the other to soften hard stereo. Per output pair."
  {enabled}
  onEnable={(v) => Runtime.setCrossfeedEnabled(s, v)}
  reason={offReason}
>
  <div class:dim={!enabled}><BodePlot {curves} height={96} crosshair={false} {yRange} /></div>
  {#if showPairs}
    <MaskChips label="PAIRS" items={pairItems} mask={cf?.outputPairMask ?? 0x01} disabled={!enabled}
      onToggle={(i) => Runtime.toggleCrossfeedOutputPair(s, i)} />
  {/if}
  <div class="prow">
    <span class="prow-lbl">PRESET</span>
    <span class="prow-ctl"><SegmentedSelect value={cf?.preset ?? 0} options={PRESET_OPTIONS} disabled={!enabled} disabledReason={offReason}
      ariaLabel="Crossfeed preset" onChange={(v) => Runtime.setCrossfeedPreset(s, v)} /></span>
  </div>
  <SliderField lane="scrub" label="CUTOFF" ariaLabel="Crossfeed cutoff frequency" value={cf?.freq ?? 700}
    min={Proc.CROSSFEED_FREQ_MIN_HZ} max={Proc.CROSSFEED_FREQ_MAX_HZ} step={Proc.CROSSFEED_FREQ_STEP_HZ}
    kind="hz" precision={0} disabled={!slidersEditable} disabledReason={reason} onChange={(v) => Runtime.setCrossfeedFreq(s, v)} />
  <SliderField lane="scrub" label="FEED" ariaLabel="Crossfeed feed level" value={cf?.feedDb ?? 4.5}
    min={Proc.CROSSFEED_FEED_MIN_DB} max={Proc.CROSSFEED_FEED_MAX_DB} step={Proc.CROSSFEED_FEED_STEP_DB}
    kind="dB" precision={1} disabled={!slidersEditable} disabledReason={reason} onChange={(v) => Runtime.setCrossfeedFeedDb(s, v)} />
  <div class="prow">
    <span class="prow-lbl">ITD</span>
    <span class="prow-ctl"><ToggleSwitch checked={cf?.itd ?? false} disabled={!enabled} disabledReason={offReason}
      ariaLabel="Crossfeed ITD" onChange={(v) => Runtime.setCrossfeedItd(s, v)} /></span>
  </div>
</ModuleFrame>

<style>
  .dim { opacity: var(--dim-off); }
</style>
