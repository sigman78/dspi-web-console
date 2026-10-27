<script lang="ts">
  import SegmentedSelect from '@/components/chrome/SegmentedSelect.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import { CrossfeedPreset, Proc, outputChannelsWithIndex } from '@/domain';
  import * as Runtime from '@/runtime';
  import { getSession } from '@/components/sessionContext';
  import BodePlot, { type BodeCurve } from '@/components/bode/BodePlot.svelte';
  import { crossfeedResponse } from '@/components/bode/crossfeedCurve';
  import { centeredDbDomain } from '@/components/bode/dbDomain';
  import ModuleFrame from './ModuleFrame.svelte';
  import ModuleSlider from './ModuleSlider.svelte';
  import MaskChips from './MaskChips.svelte';

  const s = getSession();
  const cf = $derived(s.mirror.current?.crossfeed);
  const enabled = $derived(cf?.enabled ?? false);
  const isCustom = $derived((cf?.preset ?? CrossfeedPreset.Preset1) === CrossfeedPreset.Custom);
  const slidersEditable = $derived(enabled && isCustom);

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
>
  <div class:dim={!enabled}><BodePlot {curves} height={96} crosshair={false} {yRange} /></div>
  {#if showPairs}
    <MaskChips label="PAIRS" items={pairItems} mask={cf?.outputPairMask ?? 0x01} disabled={!enabled}
      onToggle={(i) => Runtime.toggleCrossfeedOutputPair(s, i)} />
  {/if}
  <div class="r">
    <span class="lbl">PRESET</span>
    <span class="ctl"><SegmentedSelect size="sm" value={cf?.preset ?? 0} options={PRESET_OPTIONS} disabled={!enabled}
      ariaLabel="Crossfeed preset" onChange={(v) => Runtime.setCrossfeedPreset(s, v)} /></span>
  </div>
  <ModuleSlider label="CUTOFF" ariaLabel="Crossfeed cutoff frequency" value={cf?.freq ?? 700}
    min={Proc.CROSSFEED_FREQ_MIN_HZ} max={Proc.CROSSFEED_FREQ_MAX_HZ} step={Proc.CROSSFEED_FREQ_STEP_HZ}
    kind="hz" precision={0} disabled={!slidersEditable} onChange={(v) => Runtime.setCrossfeedFreq(s, v)} />
  <ModuleSlider label="FEED" ariaLabel="Crossfeed feed level" value={cf?.feedDb ?? 4.5}
    min={Proc.CROSSFEED_FEED_MIN_DB} max={Proc.CROSSFEED_FEED_MAX_DB} step={Proc.CROSSFEED_FEED_STEP_DB}
    kind="dB" precision={1} disabled={!slidersEditable} onChange={(v) => Runtime.setCrossfeedFeedDb(s, v)} />
  <div class="r">
    <span class="lbl">ITD</span>
    <span class="ctl"><ToggleSwitch size="sm" checked={cf?.itd ?? false} disabled={!enabled}
      ariaLabel="Crossfeed ITD" onChange={(v) => Runtime.setCrossfeedItd(s, v)} /></span>
  </div>
</ModuleFrame>

<style>
  .dim { opacity: 0.4; }
</style>
