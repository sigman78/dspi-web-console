<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import LabeledSlider from '@/components/chrome/LabeledSlider.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import BodePlot, { type BodeCurve } from '@/components/bode/BodePlot.svelte';
  import { loudnessResponse } from '@/components/bode/loudnessCurve';
  import { centeredDbDomain } from '@/components/bode/dbDomain';
  import { connection } from '@/state';
  import { Proc } from '@/domain';
  import { setLoudnessEnabled, setLoudnessRefSpl, setLoudnessIntensityPct } from '@/runtime';
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
</style>
