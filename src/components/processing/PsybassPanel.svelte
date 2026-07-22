<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import LabeledSlider from '@/components/chrome/LabeledSlider.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import MaskChipRow from '@/components/chrome/MaskChipRow.svelte';
  import { connection } from '@/state';
  import { Proc } from '@/domain';
  import {
    setPsybassEnabled, setPsybassCutoff, setPsybassHarmonics,
    setPsybassDrive, setPsybassCharacter, setPsybassOriginal,
    togglePsybassOutputChannel,
  } from '@/runtime';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();

  const psybass = $derived(s.mirror.current?.psybass);
  const connected = $derived(connection.connected);
  const enabled = $derived(psybass?.enabled ?? false);
  const editable = $derived(connected && enabled);

  // Per-output psybass mask (fw V23+): same output-slot convention as the
  // loudness/crossfeed masks. Meaningless with a single output; the feature
  // gate already implies wire V23+, so no separate mask-support flag.
  const outputSlotById = $derived(new Map((s.mirror.current?.outputs ?? []).map((o) => [o.id, o.wireIndex])));
  const outputChannels = $derived(
    (s.mirror.current?.channels ?? [])
      .filter((c) => c.isOutput)
      .map((c) => ({ id: c.id, name: c.name, index: outputSlotById.get(c.id) ?? 0 }))
      .sort((a, b) => a.index - b.index),
  );
  const showMask = $derived(outputChannels.length > 1);
  const outputItems = $derived(
    outputChannels.map((ch) => ({
      key: ch.id, index: ch.index, label: String(ch.index + 1), title: ch.name || `Output ${ch.index + 1}`,
    })),
  );
  const outputMask = $derived(psybass?.outputMask ?? 0xFFFF);

  function toggleEnabled() {
    if (!psybass) return;
    setPsybassEnabled(s, !psybass.enabled);
  }
</script>

<Panel code="PR.04" title="PSYBASS">
  {#snippet right()}
    <ToggleSwitch
      size="sm"
      checked={enabled}
      disabled={!connected}
      ariaLabel={enabled ? 'Disable psybass' : 'Enable psybass'}
      onChange={toggleEnabled}
    />
  {/snippet}

  <div class="grid">
    {#if showMask}
      <MaskChipRow label="OUTPUTS" items={outputItems} mask={outputMask} disabled={!editable} onToggle={(i) => togglePsybassOutputChannel(s, i)} />
      <div class="rule"></div>
    {/if}

    <LabeledSlider
      label="CUTOFF"
      ariaLabel="Psybass cutoff frequency"
      value={psybass?.cutoffHz ?? 80}
      min={Proc.PSYBASS_CUTOFF_MIN_HZ} max={Proc.PSYBASS_CUTOFF_MAX_HZ} step={Proc.PSYBASS_CUTOFF_STEP_HZ}
      kind="hz"
      precision={0}
      disabled={!editable}
      onChange={(v) => setPsybassCutoff(s, v)}
    />

    <LabeledSlider
      label="HARMONICS"
      ariaLabel="Psybass harmonics level"
      value={psybass?.harmonicsDb ?? 0}
      min={Proc.PSYBASS_HARMONICS_MIN_DB} max={Proc.PSYBASS_HARMONICS_MAX_DB} step={Proc.PSYBASS_HARMONICS_STEP_DB}
      kind="dB-signed"
      precision={1}
      disabled={!editable}
      onChange={(v) => setPsybassHarmonics(s, v)}
    />

    <LabeledSlider
      label="DRIVE"
      ariaLabel="Psybass drive"
      value={psybass?.driveDb ?? 6}
      min={Proc.PSYBASS_DRIVE_MIN_DB} max={Proc.PSYBASS_DRIVE_MAX_DB} step={Proc.PSYBASS_DRIVE_STEP_DB}
      kind="dB"
      precision={1}
      disabled={!editable}
      onChange={(v) => setPsybassDrive(s, v)}
    />

    <LabeledSlider
      label="CHARACTER"
      ariaLabel="Psybass character (even to odd harmonic blend)"
      value={psybass?.characterPct ?? 50}
      min={Proc.PSYBASS_CHARACTER_MIN_PCT} max={Proc.PSYBASS_CHARACTER_MAX_PCT} step={Proc.PSYBASS_CHARACTER_STEP_PCT}
      kind="pct"
      precision={0}
      disabled={!editable}
      onChange={(v) => setPsybassCharacter(s, v)}
    />

    <LabeledSlider
      label="ORIGINAL"
      ariaLabel="Psybass original bass level"
      value={psybass?.originalDb ?? 0}
      min={Proc.PSYBASS_ORIGINAL_MIN_DB} max={Proc.PSYBASS_ORIGINAL_MAX_DB} step={Proc.PSYBASS_ORIGINAL_STEP_DB}
      kind="dB"
      precision={1}
      disabled={!editable}
      onChange={(v) => setPsybassOriginal(s, v)}
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
  .rule {
    grid-column: 1 / -1;
    height: 1px;
    background: var(--border);
    margin: 2px 0;
  }
</style>
