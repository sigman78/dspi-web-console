<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import LabeledSlider from '@/components/chrome/LabeledSlider.svelte';
  import SegmentedSelect from '@/components/chrome/SegmentedSelect.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import MaskChipRow from '@/components/chrome/MaskChipRow.svelte';
  import BodePlot, { type BodeCurve } from '@/components/bode/BodePlot.svelte';
  import { crossfeedResponse } from '@/components/bode/crossfeedCurve';
  import { centeredDbDomain } from '@/components/bode/dbDomain';
  import { connection } from '@/state';
  import {
    setCrossfeedEnabled, setCrossfeedPreset, setCrossfeedItd,
    setCrossfeedFreq, setCrossfeedFeedDb, toggleCrossfeedOutputPair,
  } from '@/runtime';
  import { CrossfeedPreset, Proc } from '@/domain';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const cf = $derived(s.mirror.current?.crossfeed);
  const connected = $derived(connection.connected);
  const enabled = $derived(cf?.enabled ?? false);
  const isCustom = $derived((cf?.preset ?? CrossfeedPreset.Preset1) === CrossfeedPreset.Custom);
  const editable = $derived(connected && enabled);
  const slidersEditable = $derived(editable && isCustom);

  // Output-pair mask (fw V20+): which stereo output pairs get crossfeed.
  // Pair p covers output slots 2p/2p+1; the mono PDM sub never forms a pair
  // and is dropped by the floor division below. There's no dedicated
  // per-platform pair-count field, so it's derived from the live output count.
  const outputSlotById = $derived(new Map((s.mirror.current?.outputs ?? []).map((o) => [o.id, o.wireIndex])));
  const outputChannels = $derived(
    (s.mirror.current?.channels ?? [])
      .filter((c) => c.isOutput)
      .map((c) => ({ id: c.id, name: c.name, index: outputSlotById.get(c.id) ?? 0 }))
      .sort((a, b) => a.index - b.index),
  );
  const nameByIndex = $derived(new Map<number, string>(outputChannels.map((ch) => [ch.index, ch.name])));
  const pairCount = $derived(Math.min(4, Math.floor(outputChannels.length / 2)));
  // Meaningless with a single pair, and only wire V20+ has a mask to write to.
  const pairSupported = $derived(s.device.capabilities.features.crossfeedPairMask);
  const showPairs = $derived(pairSupported && pairCount > 1);
  const pairItems = $derived(
    Array.from({ length: pairCount }, (_, p) => {
      const i0 = 2 * p;
      const i1 = 2 * p + 1;
      const n0 = nameByIndex.get(i0);
      const n1 = nameByIndex.get(i1);
      return {
        key: p,
        index: p,
        label: `${i0 + 1}·${i1 + 1}`,
        title: n0 && n1 ? `${n0} / ${n1}` : `Outputs ${i0 + 1}/${i1 + 1}`,
      };
    }),
  );
  const pairMask = $derived(cf?.outputPairMask ?? 0x01);

  const resp = $derived(crossfeedResponse(cf?.freq ?? 700, cf?.feedDb ?? 4.5));
  const cfCurves = $derived<BodeCurve[]>([
    { id: 'xfeed-direct', points: resp.direct, color: 'color-mix(in oklab, var(--text) 45%, transparent)', label: 'Direct' },
    { id: 'xfeed-cross', points: resp.crossfeed, color: 'var(--accent)', label: 'Crossfeed' },
  ]);
  const cfRange = $derived(centeredDbDomain([resp.crossfeed, resp.direct]));

  // Preset labels: PRESET 1/2/3 plus CUSTOM. If the firmware ships
  // descriptive labels later, they swap in here without restructure.
  const PRESET_OPTIONS = [
    { value: CrossfeedPreset.Preset1, label: 'PRESET 1' },
    { value: CrossfeedPreset.Preset2, label: 'PRESET 2' },
    { value: CrossfeedPreset.Preset3, label: 'PRESET 3' },
    { value: CrossfeedPreset.Custom,  label: 'CUSTOM' },
  ] as const satisfies ReadonlyArray<{ value: CrossfeedPreset; label: string }>;

  function toggleEnabled() {
    if (!cf) return;
    setCrossfeedEnabled(s, !cf.enabled);
  }
  function toggleItd() {
    if (!cf) return;
    setCrossfeedItd(s, !cf.itd);
  }
</script>

<Panel code="PR.01" title="CROSSFEED">
  {#snippet right()}
    <ToggleSwitch
      size="sm"
      checked={enabled}
      disabled={!connected}
      ariaLabel={enabled ? 'Disable crossfeed' : 'Enable crossfeed'}
      onChange={toggleEnabled}
    />
  {/snippet}

  <div class="graph" class:off={!enabled}>
    <BodePlot curves={cfCurves} height={96} crosshair={false} yRange={cfRange} />
  </div>

  <div class="grid">
    {#if showPairs}
      <MaskChipRow label="PAIRS" items={pairItems} mask={pairMask} disabled={!editable} onToggle={(i) => toggleCrossfeedOutputPair(s, i)} />
      <div class="rule"></div>
    {/if}

    <span class="microlbl">PRESET</span>
    <div class="span2">
      <SegmentedSelect
        value={cf?.preset ?? 0}
        options={PRESET_OPTIONS}
        disabled={!editable}
        ariaLabel="Crossfeed preset"
        onChange={(v) => setCrossfeedPreset(s, v)}
      />
    </div>

    <LabeledSlider
      label="CUTOFF"
      ariaLabel="Crossfeed cutoff frequency"
      value={cf?.freq ?? 700}
      min={Proc.CROSSFEED_FREQ_MIN_HZ} max={Proc.CROSSFEED_FREQ_MAX_HZ} step={Proc.CROSSFEED_FREQ_STEP_HZ}
      kind="hz"
      precision={0}
      disabled={!slidersEditable}
      onChange={(v) => setCrossfeedFreq(s, v)}
    />

    <LabeledSlider
      label="FEED"
      ariaLabel="Crossfeed feed level"
      value={cf?.feedDb ?? 4.5}
      min={Proc.CROSSFEED_FEED_MIN_DB} max={Proc.CROSSFEED_FEED_MAX_DB} step={Proc.CROSSFEED_FEED_STEP_DB}
      kind="dB"
      precision={1}
      disabled={!slidersEditable}
      onChange={(v) => setCrossfeedFeedDb(s, v)}
    />

    <span class="microlbl">ITD</span>
    <div class="span2">
      <ToggleSwitch
        size="sm"
        checked={cf?.itd ?? false}
        disabled={!editable}
        ariaLabel={cf?.itd ? 'Disable ITD' : 'Enable ITD'}
        onChange={toggleItd}
      />
    </div>
  </div>
</Panel>

<style>
  .graph { padding: 10px 12px 0; }
  .graph.off { opacity: 0.4; }
  .grid {
    padding: 14px;
    display: grid;
    grid-template-columns: 90px 1fr 64px;
    align-items: center;
    gap: 12px;
  }
  .span2 { grid-column: 2 / span 2; }
  .rule {
    grid-column: 1 / -1;
    height: 1px;
    background: var(--border);
    margin: 2px 0;
  }
</style>
