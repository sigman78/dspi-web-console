<script lang="ts">
  import Panel from '../chrome/Panel.svelte';
  import ValueField from '../chrome/ValueField.svelte';
  import SegmentedSelect from '../chrome/SegmentedSelect.svelte';
  import { dsp, session } from '@/state';
  import {
    setLevellerEnabled, setLevellerSpeed, setLevellerLookahead,
    setLevellerAmount, setLevellerMaxGain, setLevellerGate,
  } from '@/runtime';
  import { LevellerSpeed } from '@/domain';

  const lv = $derived(dsp.live?.leveller);
  const connected = $derived(session.status === 'connected');
  const enabled = $derived(lv?.enabled ?? false);
  const editable = $derived(connected && enabled);

  const SPEED_OPTIONS = [
    { value: LevellerSpeed.Slow,   label: 'SLOW' },
    { value: LevellerSpeed.Medium, label: 'MED'  },
    { value: LevellerSpeed.Fast,   label: 'FAST' },
  ] as const satisfies ReadonlyArray<{ value: LevellerSpeed; label: string }>;

  function toggleEnabled() {
    if (!lv) return;
    setLevellerEnabled(!lv.enabled);
  }
  function toggleLookahead() {
    if (!lv) return;
    setLevellerLookahead(!lv.lookahead);
  }
  function onAmountInput(e: Event) {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (!Number.isNaN(v)) setLevellerAmount(v);
  }
  function onMaxGainInput(e: Event) {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (!Number.isNaN(v)) setLevellerMaxGain(v);
  }
  function onGateInput(e: Event) {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (!Number.isNaN(v)) setLevellerGate(v);
  }
</script>

<Panel code="PR.03" title="LEVELLER">
  {#snippet right()}
    <button
      class="badge"
      class:on={enabled}
      onclick={toggleEnabled}
      disabled={!connected}
      aria-label={enabled ? 'Disable leveller' : 'Enable leveller'}
    >
      {enabled ? 'ON' : 'OFF'}
    </button>
  {/snippet}

  <div class="grid">
    <span class="lbl">SPEED</span>
    <div class="span2">
      <SegmentedSelect
        value={lv?.speed ?? LevellerSpeed.Medium}
        options={SPEED_OPTIONS}
        disabled={!editable}
        ariaLabel="Leveller speed"
        onChange={(v) => setLevellerSpeed(v)}
      />
    </div>

    <span class="lbl">AMOUNT</span>
    <input
      type="range"
      min="0" max="100" step="1"
      value={lv?.amount ?? 0}
      oninput={onAmountInput}
      disabled={!editable}
      aria-label="Leveller amount"
    />
    <ValueField
      value={lv?.amount ?? 0}
      min={0} max={100} step={1}
      kind="pct"
      precision={0}
      disabled={!editable}
      onChange={(v) => setLevellerAmount(v)}
    />

    <span class="lbl">MAX GAIN</span>
    <input
      type="range"
      min="0" max="35" step="0.5"
      value={lv?.maxGainDb ?? 0}
      oninput={onMaxGainInput}
      disabled={!editable}
      aria-label="Leveller max gain"
    />
    <ValueField
      value={lv?.maxGainDb ?? 0}
      min={0} max={35} step={0.5}
      kind="dB"
      precision={1}
      disabled={!editable}
      onChange={(v) => setLevellerMaxGain(v)}
    />

    <span class="lbl">GATE</span>
    <input
      type="range"
      min="-96" max="0" step="1"
      value={lv?.gateDb ?? -40}
      oninput={onGateInput}
      disabled={!editable}
      aria-label="Leveller gate threshold"
    />
    <ValueField
      value={lv?.gateDb ?? -40}
      min={-96} max={0} step={1}
      kind="dB"
      precision={0}
      disabled={!editable}
      onChange={(v) => setLevellerGate(v)}
    />

    <span class="lbl">LOOKAHEAD</span>
    <div class="span2">
      <button
        class="toggle"
        class:on={lv?.lookahead}
        onclick={toggleLookahead}
        disabled={!editable}
        aria-pressed={lv?.lookahead ?? false}
        aria-label={lv?.lookahead ? 'Disable lookahead' : 'Enable lookahead'}
      >
        {lv?.lookahead ? 'ON' : 'OFF'}
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
