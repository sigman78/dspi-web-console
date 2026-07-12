<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import LabeledSlider from '@/components/chrome/LabeledSlider.svelte';
  import SegmentedSelect from '@/components/chrome/SegmentedSelect.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import MaskChipRow from '@/components/chrome/MaskChipRow.svelte';
  import { connection } from '@/state';
  import {
    setLevellerEnabled, setLevellerSpeed, setLevellerLookahead,
    setLevellerAmount, setLevellerMaxGain, setLevellerGate,
    setLevellerMasks, toggleLevellerDetectorChannel, toggleLevellerApplyChannel,
  } from '@/runtime';
  import { LevellerSpeed, Proc, inputIndexOf } from '@/domain';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const lv = $derived(s.mirror.current?.leveller);
  const connected = $derived(connection.connected);
  const enabled = $derived(lv?.enabled ?? false);
  const editable = $derived(connected && enabled);

  const SPEED_OPTIONS = [
    { value: LevellerSpeed.Slow,   label: 'SLOW' },
    { value: LevellerSpeed.Medium, label: 'MED'  },
    { value: LevellerSpeed.Fast,   label: 'FAST' },
  ] as const satisfies ReadonlyArray<{ value: LevellerSpeed; label: string }>;

  // Multichannel leveller masks (fw V18+): which input channels feed the shared
  // detector, and which receive the gain. Meaningless with a single stereo
  // input, so the whole block is hidden unless more than two inputs are live.
  const inputChannels = $derived(
    (s.mirror.current?.channels ?? [])
      .filter((c) => !c.isOutput)
      .map((c) => ({ id: c.id, name: c.name, index: inputIndexOf(c.id) ?? 0 }))
      .sort((a, b) => a.index - b.index),
  );
  const activeCount = $derived(s.telemetry.activeInputChannels ?? inputChannels.length);
  const channelCount = $derived(Math.min(Math.max(activeCount, 2), inputChannels.length || 2));
  // Masks are wire V18 only. V16/V17 firmware (incl. 1.1.5-beta3) carries no
  // mask bytes, so a toggle would 0xDE-stall and snap back on the next bulk
  // refresh -- hide the whole block unless the device actually supports it.
  const masksSupported = $derived(s.device.capabilities.features.levellerMasks);
  const showMasks = $derived(masksSupported && inputChannels.length > 2 && channelCount > 2);
  const shownChannels = $derived(inputChannels.slice(0, channelCount));

  const detectorMask = $derived(lv?.detectorMask ?? 0xFF);
  const applyMask = $derived(lv?.applyMask ?? 0xFF);
  const channelItems = $derived(
    shownChannels.map((ch) => ({
      key: ch.id, index: ch.index, label: String(ch.index + 1), title: ch.name || `Input ${ch.index + 1}`,
    })),
  );

  // detector/apply bitmasks over input indices; mirror the macOS reference.
  const MASK_PRESETS = [
    { label: 'ALL', title: 'All channels (night mode)', detector: 0xFF, apply: 0xFF },
    { label: 'L·R', title: 'Front L/R only',            detector: 0x03, apply: 0x03 },
    { label: 'CTR', title: 'Center only (dialog boost)', detector: 0x04, apply: 0x04 },
  ] as const;

  function toggleEnabled() {
    if (!lv) return;
    setLevellerEnabled(s, !lv.enabled);
  }
  function toggleLookahead() {
    if (!lv) return;
    setLevellerLookahead(s, !lv.lookahead);
  }
</script>

<Panel code="PR.03" title="LEVELLER">
  {#snippet right()}
    <ToggleSwitch
      size="sm"
      checked={enabled}
      disabled={!connected}
      ariaLabel={enabled ? 'Disable leveller' : 'Enable leveller'}
      onChange={toggleEnabled}
    />
  {/snippet}

  <div class="grid">
    {#if showMasks}
      <span class="microlbl">CHANNELS</span>
      <div class="presets span2">
        {#each MASK_PRESETS as p (p.label)}
          <button
            type="button"
            class="preset"
            disabled={!editable}
            title={p.title}
            onclick={() => { if (editable) setLevellerMasks(s, p.detector, p.apply); }}
          >{p.label}</button>
        {/each}
      </div>

      <MaskChipRow label="DETECTOR" items={channelItems} mask={detectorMask} disabled={!editable} onToggle={(i) => toggleLevellerDetectorChannel(s, i)} />
      <MaskChipRow label="APPLY" items={channelItems} mask={applyMask} disabled={!editable} onToggle={(i) => toggleLevellerApplyChannel(s, i)} />

      <div class="rule"></div>
    {/if}

    <span class="microlbl">SPEED</span>
    <div class="span2">
      <SegmentedSelect
        value={lv?.speed ?? LevellerSpeed.Medium}
        options={SPEED_OPTIONS}
        disabled={!editable}
        ariaLabel="Leveller speed"
        onChange={(v) => setLevellerSpeed(s, v)}
      />
    </div>

    <LabeledSlider
      label="AMOUNT"
      ariaLabel="Leveller amount"
      value={lv?.amount ?? 0}
      min={Proc.LEVELLER_AMOUNT_MIN_PCT} max={Proc.LEVELLER_AMOUNT_MAX_PCT} step={Proc.LEVELLER_AMOUNT_STEP_PCT}
      kind="pct"
      precision={0}
      disabled={!editable}
      onChange={(v) => setLevellerAmount(s, v)}
    />

    <LabeledSlider
      label="MAX GAIN"
      ariaLabel="Leveller max gain"
      value={lv?.maxGainDb ?? 0}
      min={Proc.LEVELLER_MAX_GAIN_MIN_DB} max={Proc.LEVELLER_MAX_GAIN_MAX_DB} step={Proc.LEVELLER_MAX_GAIN_STEP_DB}
      kind="dB"
      precision={1}
      disabled={!editable}
      onChange={(v) => setLevellerMaxGain(s, v)}
    />

    <LabeledSlider
      label="GATE"
      ariaLabel="Leveller gate threshold"
      value={lv?.gateDb ?? -40}
      min={Proc.LEVELLER_GATE_MIN_DB} max={Proc.LEVELLER_GATE_MAX_DB} step={Proc.LEVELLER_GATE_STEP_DB}
      kind="dB"
      precision={0}
      disabled={!editable}
      onChange={(v) => setLevellerGate(s, v)}
    />

    <span class="microlbl">LOOKAHEAD</span>
    <div class="span2">
      <ToggleSwitch
        size="sm"
        checked={lv?.lookahead ?? false}
        disabled={!editable}
        ariaLabel={lv?.lookahead ? 'Disable lookahead' : 'Enable lookahead'}
        onChange={toggleLookahead}
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

  .presets {
    display: flex;
    justify-content: flex-end;
    gap: 4px;
  }
  .preset {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 1px;
    padding: 3px 7px;
    color: var(--text-dim);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
  }
  .preset:hover:not(:disabled) { color: var(--text); background: var(--wash); }
  .preset:disabled { cursor: default; opacity: var(--dim-disabled); }

  .rule {
    grid-column: 1 / -1;
    height: 1px;
    background: var(--border);
    margin: 2px 0;
  }
</style>
