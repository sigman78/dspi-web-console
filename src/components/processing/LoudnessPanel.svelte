<script lang="ts">
  import Panel from '../chrome/Panel.svelte';
  import ValueField from '../chrome/ValueField.svelte';
  import ToggleSwitch from '../chrome/ToggleSwitch.svelte';
  import { dsp, session } from '@/state';
  import { Proc } from '@/domain';
  import { setLoudnessEnabled, setLoudnessRefSpl, setLoudnessIntensityPct } from '@/runtime';

  const loudness = $derived(dsp.draft?.loudness);
  const connected = $derived(session.status === 'connected');
  const enabled = $derived(loudness?.enabled ?? false);
  const editable = $derived(connected && enabled);

  function toggleEnabled() {
    if (!loudness) return;
    setLoudnessEnabled(!loudness.enabled);
  }

  function onRefSplInput(e: Event) {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (!Number.isNaN(v)) setLoudnessRefSpl(v);
  }

  function onIntensityInput(e: Event) {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (!Number.isNaN(v)) setLoudnessIntensityPct(v);
  }
</script>

<Panel code="PR.02" title="LOUDNESS">
  {#snippet right()}
    <ToggleSwitch
      size="sm"
      checked={enabled}
      disabled={!connected}
      ariaLabel={enabled ? 'Disable loudness' : 'Enable loudness'}
      onChange={toggleEnabled}
    />
  {/snippet}

  <div class="grid">
    <span class="lbl">REF SPL</span>
    <input
      type="range"
      min={Proc.LOUDNESS_REF_SPL_MIN_DB} max={Proc.LOUDNESS_REF_SPL_MAX_DB} step={Proc.LOUDNESS_REF_SPL_STEP_DB}
      value={loudness?.refSpl ?? 85}
      oninput={onRefSplInput}
      disabled={!editable}
      aria-label="Loudness reference SPL"
    />
    <ValueField
      value={loudness?.refSpl ?? 85}
      min={Proc.LOUDNESS_REF_SPL_MIN_DB} max={Proc.LOUDNESS_REF_SPL_MAX_DB} step={Proc.LOUDNESS_REF_SPL_STEP_DB}
      kind="dB"
      precision={0}
      disabled={!editable}
      onChange={(v) => setLoudnessRefSpl(v)}
    />

    <span class="lbl">INTENSITY</span>
    <input
      type="range"
      min={Proc.LOUDNESS_INTENSITY_MIN_PCT} max={Proc.LOUDNESS_INTENSITY_MAX_PCT} step={Proc.LOUDNESS_INTENSITY_STEP_PCT}
      value={loudness?.intensityPct ?? 0}
      oninput={onIntensityInput}
      disabled={!editable}
      aria-label="Loudness intensity"
    />
    <ValueField
      value={loudness?.intensityPct ?? 0}
      min={Proc.LOUDNESS_INTENSITY_MIN_PCT} max={Proc.LOUDNESS_INTENSITY_MAX_PCT} step={Proc.LOUDNESS_INTENSITY_STEP_PCT}
      kind="pct"
      precision={1}
      disabled={!editable}
      onChange={(v) => setLoudnessIntensityPct(v)}
    />
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
  .lbl {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-faint);
    letter-spacing: 1px;
  }
  input[type="range"] {
    accent-color: var(--accent);
    margin: 0;
  }
  input[type="range"]:disabled { opacity: 0.4; cursor: default; }
</style>
