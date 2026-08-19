<script lang="ts">
  import ProcPanel from './ProcPanel.svelte';
  import LabeledSlider from '@/components/chrome/LabeledSlider.svelte';
  import MaskChipRow from '@/components/chrome/MaskChipRow.svelte';
  import { connection } from '@/state';
  import { Proc, outputChannelsWithIndex, maskChipItems } from '@/domain';
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
  const outputChannels = $derived(outputChannelsWithIndex(s.mirror.current));
  const showMask = $derived(outputChannels.length > 1);
  const outputItems = $derived(maskChipItems(outputChannels, 'Output'));
  const outputMask = $derived(psybass?.outputMask ?? 0xFFFF);
</script>

<ProcPanel
  code="PR.04"
  title="PSYBASS"
  subject="psybass"
  {enabled}
  {connected}
  onToggle={() => psybass && setPsybassEnabled(s, !psybass.enabled)}
>
  <div class="proc-grid">
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
</ProcPanel>
