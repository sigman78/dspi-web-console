<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import LabeledSlider from '@/components/chrome/LabeledSlider.svelte';
  import SegmentedSelect from '@/components/chrome/SegmentedSelect.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import { connection } from '@/state';
  import {
    setLevellerEnabled, setLevellerSpeed, setLevellerLookahead,
    setLevellerAmount, setLevellerMaxGain, setLevellerGate,
  } from '@/runtime';
  import { LevellerSpeed, Proc } from '@/domain';
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
</style>
