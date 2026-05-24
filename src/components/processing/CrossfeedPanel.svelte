<script lang="ts">
  import Panel from '../chrome/Panel.svelte';
  import ValueField from '../chrome/ValueField.svelte';
  import SegmentedSelect from '../chrome/SegmentedSelect.svelte';
  import ToggleSwitch from '../chrome/ToggleSwitch.svelte';
  import { dsp, session } from '@/state';
  import {
    setCrossfeedEnabled, setCrossfeedPreset, setCrossfeedItd,
    setCrossfeedFreq, setCrossfeedFeedDb,
  } from '@/runtime';
  import { CrossfeedPreset, Proc } from '@/domain';

  const cf = $derived(dsp.draft?.crossfeed);
  const connected = $derived(session.status === 'connected');
  const enabled = $derived(cf?.enabled ?? false);
  const isCustom = $derived((cf?.preset ?? CrossfeedPreset.Preset1) === CrossfeedPreset.Custom);
  const editable = $derived(connected && enabled);
  const slidersEditable = $derived(editable && isCustom);

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
    setCrossfeedEnabled(!cf.enabled);
  }
  function toggleItd() {
    if (!cf) return;
    setCrossfeedItd(!cf.itd);
  }
  function onFreqInput(e: Event) {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (!Number.isNaN(v)) setCrossfeedFreq(v);
  }
  function onFeedInput(e: Event) {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (!Number.isNaN(v)) setCrossfeedFeedDb(v);
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

  <div class="grid">
    <span class="lbl">PRESET</span>
    <div class="span2">
      <SegmentedSelect
        value={cf?.preset ?? 0}
        options={PRESET_OPTIONS}
        disabled={!editable}
        ariaLabel="Crossfeed preset"
        onChange={(v) => setCrossfeedPreset(v)}
      />
    </div>

    <span class="lbl">CUTOFF</span>
    <input
      type="range"
      min={Proc.CROSSFEED_FREQ_MIN_HZ} max={Proc.CROSSFEED_FREQ_MAX_HZ} step={Proc.CROSSFEED_FREQ_STEP_HZ}
      value={cf?.freq ?? 700}
      oninput={onFreqInput}
      disabled={!slidersEditable}
      aria-label="Crossfeed cutoff frequency"
    />
    <ValueField
      value={cf?.freq ?? 700}
      min={Proc.CROSSFEED_FREQ_MIN_HZ} max={Proc.CROSSFEED_FREQ_MAX_HZ} step={Proc.CROSSFEED_FREQ_STEP_HZ}
      kind="hz"
      precision={0}
      disabled={!slidersEditable}
      onChange={(v) => setCrossfeedFreq(v)}
    />

    <span class="lbl">FEED</span>
    <input
      type="range"
      min={Proc.CROSSFEED_FEED_MIN_DB} max={Proc.CROSSFEED_FEED_MAX_DB} step={Proc.CROSSFEED_FEED_STEP_DB}
      value={cf?.feedDb ?? 4.5}
      oninput={onFeedInput}
      disabled={!slidersEditable}
      aria-label="Crossfeed feed level"
    />
    <ValueField
      value={cf?.feedDb ?? 4.5}
      min={Proc.CROSSFEED_FEED_MIN_DB} max={Proc.CROSSFEED_FEED_MAX_DB} step={Proc.CROSSFEED_FEED_STEP_DB}
      kind="dB"
      precision={1}
      disabled={!slidersEditable}
      onChange={(v) => setCrossfeedFeedDb(v)}
    />

    <span class="lbl">ITD</span>
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
  .grid {
    padding: 14px;
    display: grid;
    grid-template-columns: 90px 1fr 64px;
    align-items: center;
    gap: 12px;
  }
  .span2 { grid-column: 2 / span 2; }
  .lbl {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-faint);
    letter-spacing: 1px;
  }
  input[type="range"] { accent-color: var(--accent); margin: 0; }
  input[type="range"]:disabled { opacity: 0.4; cursor: default; }
</style>
