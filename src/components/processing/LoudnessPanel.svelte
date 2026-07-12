<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import LabeledSlider from '@/components/chrome/LabeledSlider.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import MaskChipRow from '@/components/chrome/MaskChipRow.svelte';
  import BodePlot, { type BodeCurve } from '@/components/bode/BodePlot.svelte';
  import { loudnessResponse } from '@/components/bode/loudnessCurve';
  import { centeredDbDomain } from '@/components/bode/dbDomain';
  import { connection } from '@/state';
  import { Proc } from '@/domain';
  import { setLoudnessEnabled, setLoudnessRefSpl, setLoudnessIntensityPct, toggleLoudnessOutputChannel } from '@/runtime';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();

  const loudness = $derived(s.mirror.current?.loudness);
  const connected = $derived(connection.connected);
  const enabled = $derived(loudness?.enabled ?? false);
  const editable = $derived(connected && enabled);

  const loudCurve = $derived<BodeCurve[]>([
    { id: 'loudness', points: loudnessResponse(loudness?.refSpl ?? 85, loudness?.intensityPct ?? 0) },
  ]);
  const loudRange = $derived(centeredDbDomain([loudCurve[0].points]));

  // Per-output loudness mask (fw V19+): which output channels get loudness
  // compensation. Index is the platform-compact protocol output slot (the
  // same one OutputModel.wireIndex carries), not the raw ChannelId -- bit k
  // on the wire means output slot k, PDM included.
  const outputSlotById = $derived(new Map((s.mirror.current?.outputs ?? []).map((o) => [o.id, o.wireIndex])));
  const outputChannels = $derived(
    (s.mirror.current?.channels ?? [])
      .filter((c) => c.isOutput)
      .map((c) => ({ id: c.id, name: c.name, index: outputSlotById.get(c.id) ?? 0 }))
      .sort((a, b) => a.index - b.index),
  );
  // Meaningless with a single output, and only wire V19+ has a mask to write to.
  const maskSupported = $derived(s.device.capabilities.features.loudnessOutputMask);
  const showMask = $derived(maskSupported && outputChannels.length > 1);
  const outputItems = $derived(
    outputChannels.map((ch) => ({
      key: ch.id, index: ch.index, label: String(ch.index + 1), title: ch.name || `Output ${ch.index + 1}`,
    })),
  );
  const outputMask = $derived(loudness?.outputMask ?? 0xFFFF);

  function toggleEnabled() {
    if (!loudness) return;
    setLoudnessEnabled(s, !loudness.enabled);
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

  <div class="graph" class:off={!enabled}>
    <BodePlot curves={loudCurve} height={96} crosshair={false} yRange={loudRange} />
  </div>

  <div class="grid">
    {#if showMask}
      <MaskChipRow label="OUTPUTS" items={outputItems} mask={outputMask} disabled={!editable} onToggle={(i) => toggleLoudnessOutputChannel(s, i)} />
      <div class="rule"></div>
    {/if}

    <LabeledSlider
      label="REF SPL"
      ariaLabel="Loudness reference SPL"
      value={loudness?.refSpl ?? 85}
      min={Proc.LOUDNESS_REF_SPL_MIN_DB} max={Proc.LOUDNESS_REF_SPL_MAX_DB} step={Proc.LOUDNESS_REF_SPL_STEP_DB}
      kind="dB"
      precision={0}
      disabled={!editable}
      onChange={(v) => setLoudnessRefSpl(s, v)}
    />

    <LabeledSlider
      label="INTENSITY"
      ariaLabel="Loudness intensity"
      value={loudness?.intensityPct ?? 0}
      min={Proc.LOUDNESS_INTENSITY_MIN_PCT} max={Proc.LOUDNESS_INTENSITY_MAX_PCT} step={Proc.LOUDNESS_INTENSITY_STEP_PCT}
      kind="pct"
      precision={1}
      disabled={!editable}
      onChange={(v) => setLoudnessIntensityPct(s, v)}
    />
  </div>
</Panel>

<style>
  .graph { padding: 10px 12px 0; }
  .graph.off { opacity: 0.4; }
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
