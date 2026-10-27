<script lang="ts">
  import { Proc, outputChannelsWithIndex, maskChipItems } from '@/domain';
  import * as Runtime from '@/runtime';
  import { getSession } from '@/components/sessionContext';
  import ModuleFrame from './ModuleFrame.svelte';
  import ModuleSlider from './ModuleSlider.svelte';
  import MaskChips from './MaskChips.svelte';

  const s = getSession();
  const pb = $derived(s.mirror.current?.psybass);
  const enabled = $derived(pb?.enabled ?? false);

  const outputChannels = $derived(outputChannelsWithIndex(s.mirror.current));
  const showMask = $derived(outputChannels.length > 1);
  const outputItems = $derived(maskChipItems(outputChannels, 'Output'));
</script>

<ModuleFrame
  title="Psybass"
  pass="per output · after matrix, before crossover"
  blurb="Synthesises harmonics of bass the speaker cannot reproduce, so the ear infers the fundamental. Runs before the output crossover."
  {enabled}
>
  {#if showMask}
    <MaskChips label="OUTPUTS" items={outputItems} mask={pb?.outputMask ?? 0xFFFF} disabled={!enabled}
      onToggle={(i) => Runtime.togglePsybassOutputChannel(s, i)} />
  {/if}
  <ModuleSlider label="CUTOFF" ariaLabel="Psybass cutoff frequency" value={pb?.cutoffHz ?? 80}
    min={Proc.PSYBASS_CUTOFF_MIN_HZ} max={Proc.PSYBASS_CUTOFF_MAX_HZ} step={Proc.PSYBASS_CUTOFF_STEP_HZ}
    kind="hz" precision={0} disabled={!enabled} onChange={(v) => Runtime.setPsybassCutoff(s, v)} />
  <ModuleSlider label="HARMONICS" ariaLabel="Psybass harmonics level" value={pb?.harmonicsDb ?? 0}
    min={Proc.PSYBASS_HARMONICS_MIN_DB} max={Proc.PSYBASS_HARMONICS_MAX_DB} step={Proc.PSYBASS_HARMONICS_STEP_DB}
    kind="dB-signed" precision={1} disabled={!enabled} onChange={(v) => Runtime.setPsybassHarmonics(s, v)} />
  <ModuleSlider label="DRIVE" ariaLabel="Psybass drive" value={pb?.driveDb ?? 6}
    min={Proc.PSYBASS_DRIVE_MIN_DB} max={Proc.PSYBASS_DRIVE_MAX_DB} step={Proc.PSYBASS_DRIVE_STEP_DB}
    kind="dB" precision={1} disabled={!enabled} onChange={(v) => Runtime.setPsybassDrive(s, v)} />
  <ModuleSlider label="CHARACTER" ariaLabel="Psybass character (even to odd harmonic blend)" value={pb?.characterPct ?? 50}
    min={Proc.PSYBASS_CHARACTER_MIN_PCT} max={Proc.PSYBASS_CHARACTER_MAX_PCT} step={Proc.PSYBASS_CHARACTER_STEP_PCT}
    kind="pct" precision={0} disabled={!enabled} onChange={(v) => Runtime.setPsybassCharacter(s, v)} />
  <ModuleSlider label="ORIGINAL" ariaLabel="Psybass original bass level" value={pb?.originalDb ?? 0}
    min={Proc.PSYBASS_ORIGINAL_MIN_DB} max={Proc.PSYBASS_ORIGINAL_MAX_DB} step={Proc.PSYBASS_ORIGINAL_STEP_DB}
    kind="dB" precision={1} disabled={!enabled} onChange={(v) => Runtime.setPsybassOriginal(s, v)} />
</ModuleFrame>
