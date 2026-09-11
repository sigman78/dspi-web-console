<script lang="ts">
  import ProcPanel from './ProcPanel.svelte';
  import LabeledSlider from '@/components/chrome/LabeledSlider.svelte';
  import MaskChipRow from '@/components/chrome/MaskChipRow.svelte';
  import { connection } from '@/state';
  import { Proc, outputChannelsWithIndex, maskChipItems, subharmReservePlan } from '@/domain';
  import {
    setSubharmEnabled, setSubharmLow, setSubharmHigh, setSubharmBoost,
    toggleSubharmOutputChannel, reserveSubharmHeadroom,
  } from '@/runtime';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();

  const snapshot = $derived(s.mirror.current);
  const subharm = $derived(snapshot?.subharm);
  const connected = $derived(connection.connected);
  const enabled = $derived(subharm?.enabled ?? false);
  const editable = $derived(connected && enabled);

  // Per-output subharm mask (fw V29+): same output-slot convention as the
  // loudness/crossfeed/psybass masks.
  const outputChannels = $derived(outputChannelsWithIndex(snapshot));
  const showMask = $derived(outputChannels.length > 1);
  const outputItems = $derived(maskChipItems(outputChannels, 'Output'));
  const outputMask = $derived(subharm?.outputMask ?? 0xFFFF);

  // Headroom readout + RESERVE affordance (see mixerView.subharmReservePlan).
  // A non-finite reading (NaN/Infinity) renders like "not read yet" (null).
  const rawHeadroomDb = $derived(s.telemetry.subharmHeadroomDb);
  const headroomDb = $derived(
    rawHeadroomDb !== null && Number.isFinite(rawHeadroomDb) ? rawHeadroomDb : null,
  );
  const plan = $derived(snapshot ? subharmReservePlan(snapshot, headroomDb ?? 0) : []);
  const reserved = $derived(editable && (headroomDb ?? 0) > 0 && plan.length === 0);
  const headroomText = $derived(headroomDb === null ? '—' : `${headroomDb.toFixed(1)} dB`);
  const headroomHint = $derived(
    headroomDb !== null && headroomDb > 0 ? `input preamps ≤ −${headroomDb.toFixed(1)} dB` : null,
  );
</script>

<ProcPanel
  code="PR.06"
  title="SUBHARMONIC"
  subject="subharm"
  {enabled}
  {connected}
  onToggle={() => subharm && setSubharmEnabled(s, !subharm.enabled)}
>
  <div class="proc-grid">
    {#if showMask}
      <MaskChipRow label="OUTPUTS" items={outputItems} mask={outputMask} disabled={!editable} onToggle={(i) => toggleSubharmOutputChannel(s, i)} />
      <div class="rule"></div>
    {/if}

    <LabeledSlider
      label="24–36 HZ"
      ariaLabel="Subharmonic 24 to 36 hertz band level"
      value={subharm?.lowDb ?? Proc.SUBHARM_LEVEL_MIN_DB}
      min={Proc.SUBHARM_LEVEL_MIN_DB} max={Proc.SUBHARM_LEVEL_MAX_DB} step={Proc.SUBHARM_LEVEL_STEP_DB}
      kind="dB-signed"
      precision={1}
      floorLabel="Off"
      disabled={!editable}
      onChange={(v) => setSubharmLow(s, v)}
    />

    <LabeledSlider
      label="36–56 HZ"
      ariaLabel="Subharmonic 36 to 56 hertz band level"
      value={subharm?.highDb ?? Proc.SUBHARM_LEVEL_MIN_DB}
      min={Proc.SUBHARM_LEVEL_MIN_DB} max={Proc.SUBHARM_LEVEL_MAX_DB} step={Proc.SUBHARM_LEVEL_STEP_DB}
      kind="dB-signed"
      precision={1}
      floorLabel="Off"
      disabled={!editable}
      onChange={(v) => setSubharmHigh(s, v)}
    />

    <LabeledSlider
      label="LF BOOST"
      ariaLabel="Subharmonic LF boost"
      value={subharm?.boostDb ?? 0}
      min={Proc.SUBHARM_BOOST_MIN_DB} max={Proc.SUBHARM_BOOST_MAX_DB} step={Proc.SUBHARM_BOOST_STEP_DB}
      kind="dB"
      precision={1}
      disabled={!editable}
      onChange={(v) => setSubharmBoost(s, v)}
    />

    <div class="rule"></div>
    <span class="microlbl">HEADROOM</span>
    <div class="span2 headroom">
      <div class="headroom-line">
        <span class="readout">{headroomText}</span>
        {#if reserved}
          <span class="hint reserved">RESERVED</span>
        {:else}
          <button
            type="button"
            class="chip accent"
            aria-label="Lower input preamps to reserve the subharmonic headroom"
            disabled={!editable || plan.length === 0}
            onclick={() => reserveSubharmHeadroom(s)}
          >RESERVE</button>
        {/if}
      </div>
      {#if headroomHint}<p class="hint">{headroomHint}</p>{/if}
    </div>
  </div>
</ProcPanel>

<style>
  .headroom-line { display: flex; align-items: center; gap: 8px; }
  .readout { font-family: var(--font-mono); font-size: 11px; font-weight: 600; color: var(--text); }
  .hint.reserved { color: var(--ok); font-weight: 700; letter-spacing: 1px; }
</style>
