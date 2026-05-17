<script lang="ts">
  import Panel from '../chrome/Panel.svelte';
  import ValueField from '../chrome/ValueField.svelte';
  import SegmentedSelect from '../chrome/SegmentedSelect.svelte';
  import { dsp, session } from '../../state';
  import {
    setCrossfeedEnabled, setCrossfeedPreset, setCrossfeedItd,
    setCrossfeedFreq, setCrossfeedFeedDb,
  } from '../../runtime/actions';
  import { CrossfeedPreset } from '../../domain';

  const cf = $derived(dsp.live?.crossfeed);
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
    <button
      class="badge"
      class:on={enabled}
      onclick={toggleEnabled}
      disabled={!connected}
      aria-label={enabled ? 'Disable crossfeed' : 'Enable crossfeed'}
    >
      {enabled ? 'ON' : 'OFF'}
    </button>
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
      min="500" max="2000" step="10"
      value={cf?.freq ?? 700}
      oninput={onFreqInput}
      disabled={!slidersEditable}
      aria-label="Crossfeed cutoff frequency"
    />
    <ValueField
      value={cf?.freq ?? 700}
      min={500} max={2000} step={10}
      kind="hz"
      precision={0}
      disabled={!slidersEditable}
      onChange={(v) => setCrossfeedFreq(v)}
    />

    <span class="lbl">FEED</span>
    <input
      type="range"
      min="0" max="15" step="0.5"
      value={cf?.feedDb ?? 4.5}
      oninput={onFeedInput}
      disabled={!slidersEditable}
      aria-label="Crossfeed feed level"
    />
    <ValueField
      value={cf?.feedDb ?? 4.5}
      min={0} max={15} step={0.5}
      kind="dB"
      precision={1}
      disabled={!slidersEditable}
      onChange={(v) => setCrossfeedFeedDb(v)}
    />

    <span class="lbl">ITD</span>
    <div class="span2">
      <button
        class="toggle"
        class:on={cf?.itd}
        onclick={toggleItd}
        disabled={!editable}
        aria-pressed={cf?.itd ?? false}
        aria-label={cf?.itd ? 'Disable ITD' : 'Enable ITD'}
      >
        {cf?.itd ? 'ON' : 'OFF'}
      </button>
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
  .badge {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 1px;
    padding: 2px 6px;
    border-radius: 3px;
    background: color-mix(in oklab, var(--text) 4%, transparent);
    border: 1px solid var(--border);
    color: var(--text-faint);
    cursor: pointer;
  }
  .badge:hover:not(:disabled) { color: var(--text); border-color: var(--border-hi); }
  .badge:disabled { cursor: default; opacity: 0.5; }
  .badge.on {
    background: color-mix(in oklab, var(--ok) 10%, transparent);
    border-color: color-mix(in oklab, var(--ok) 40%, transparent);
    color: var(--ok);
  }
  .toggle {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 1px;
    padding: 3px 10px;
    border-radius: 4px;
    background: color-mix(in oklab, var(--text) 4%, transparent);
    border: 1px solid var(--border);
    color: var(--text-dim);
    cursor: pointer;
  }
  .toggle:hover:not(:disabled) { color: var(--text); border-color: var(--border-hi); }
  .toggle:disabled { cursor: default; opacity: 0.4; }
  .toggle.on {
    background: color-mix(in oklab, var(--ok) 10%, transparent);
    border-color: color-mix(in oklab, var(--ok) 40%, transparent);
    color: var(--ok);
  }
</style>
