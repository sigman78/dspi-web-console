<script lang="ts">
  import Panel from '../chrome/Panel.svelte';
  import ValueField from '../chrome/ValueField.svelte';
  import { dsp, session } from '../../state';
  import { setLoudnessEnabled, setLoudnessRefSpl, setLoudnessIntensityPct } from '../../runtime/actions';

  const loudness = $derived(dsp.live?.loudness);
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
    <button
      class="badge"
      class:on={enabled}
      onclick={toggleEnabled}
      disabled={!connected}
      aria-label={enabled ? 'Disable loudness' : 'Enable loudness'}
    >
      {enabled ? 'ON' : 'OFF'}
    </button>
  {/snippet}

  <div class="grid">
    <span class="lbl">REF SPL</span>
    <input
      type="range"
      min="40" max="100" step="1"
      value={loudness?.refSpl ?? 85}
      oninput={onRefSplInput}
      disabled={!editable}
      aria-label="Loudness reference SPL"
    />
    <ValueField
      value={loudness?.refSpl ?? 85}
      min={40} max={100} step={1}
      kind="dB"
      precision={0}
      disabled={!editable}
      onChange={(v) => setLoudnessRefSpl(v)}
    />

    <span class="lbl">INTENSITY</span>
    <input
      type="range"
      min="0" max="200" step="0.5"
      value={loudness?.intensityPct ?? 0}
      oninput={onIntensityInput}
      disabled={!editable}
      aria-label="Loudness intensity"
    />
    <ValueField
      value={loudness?.intensityPct ?? 0}
      min={0} max={200} step={0.5}
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
  .badge:hover:not(:disabled) {
    color: var(--text);
    border-color: var(--border-hi);
  }
  .badge:disabled { cursor: default; opacity: 0.5; }
  .badge.on {
    background: color-mix(in oklab, var(--ok) 10%, transparent);
    border-color: color-mix(in oklab, var(--ok) 40%, transparent);
    color: var(--ok);
  }
</style>
