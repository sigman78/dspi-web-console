<script lang="ts">
  import ProcPanel from './ProcPanel.svelte';
  import LabeledSlider from '@/components/chrome/LabeledSlider.svelte';
  import MaskChipRow from '@/components/chrome/MaskChipRow.svelte';
  import SegmentedSelect from '@/components/chrome/SegmentedSelect.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import { Proc, SubharmSelect, outputChannelsWithIndex, maskChipItems, subharmReservePlan } from '@/domain';
  import {
    setSubharmEnabled, setSubharmLow, setSubharmHigh, setSubharmBoost,
    toggleSubharmOutputChannel, reserveSubharmHeadroom,
    setSubharmTop, setSubharmSelectMode, setSubharmDepth, setSubharmHold,
    setSubharmCeiling, setSubharmLinkPairs, setSubharmSolo, fetchSubharmSolo,
  } from '@/runtime';
  import { getSession } from '@/components/sessionContext';
  import { untrack } from 'svelte';

  const s = getSession();

  const snapshot = $derived(s.mirror.current);
  const subharm = $derived(snapshot?.subharm);
  const enabled = $derived(subharm?.enabled ?? false);
  const editable = $derived(enabled);

  // V30 tail (fw 1.1.6-beta3): third band, selectivity, ceiling, pair link,
  // solo monitor, sub meter.
  const ext = $derived(s.device.capabilities?.features.subharmExt ?? false);
  const selectMode = $derived(subharm?.selectMode ?? SubharmSelect.All);
  const selectivityEditable = $derived(editable && selectMode !== SubharmSelect.All);
  const linkPairs = $derived(subharm?.linkPairs ?? true);
  const solo = $derived(s.telemetry.subharmSolo);
  const meter = $derived(s.telemetry.subharmMeter);

  const SELECT_MODE_OPTIONS = [
    { value: SubharmSelect.All,        label: 'ALL'        },
    { value: SubharmSelect.Percussive, label: 'PERCUSSIVE' },
    { value: SubharmSelect.Sustained,  label: 'SUSTAINED'  },
  ] as const satisfies ReadonlyArray<{ value: SubharmSelect; label: string }>;

  // Per-output subharm mask (fw V29+): same output-slot convention as the
  // loudness/crossfeed/psybass masks.
  const outputChannels = $derived(outputChannelsWithIndex(snapshot));
  const showMask = $derived(outputChannels.length > 1);
  const outputItems = $derived(maskChipItems(outputChannels, 'Output'));
  const outputMask = $derived(subharm?.outputMask ?? 0xFFFF);
  const maskedOutputs = $derived(outputChannels.filter((ch) => (outputMask & (1 << ch.index)) !== 0));

  // Hold meter-poll interest while mounted (poll.ts subharmMeter cadence) and
  // seed the solo mirror once -- runtime-only, no notify to catch a change
  // made from elsewhere.
  $effect(() => {
    if (!ext) return;
    // untrack: the interest counter is read+written by wantSubharmMeter, which
    // would otherwise make this effect depend on its own write.
    const release = untrack(() => s.telemetry.wantSubharmMeter());
    void fetchSubharmSolo(s);
    return release;
  });

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

    {#if ext}
      <LabeledSlider
        label="56–80 HZ"
        ariaLabel="Subharmonic 56 to 80 hertz band level"
        value={subharm?.topDb ?? Proc.SUBHARM_LEVEL_MIN_DB}
        min={Proc.SUBHARM_LEVEL_MIN_DB} max={Proc.SUBHARM_LEVEL_MAX_DB} step={Proc.SUBHARM_LEVEL_STEP_DB}
        kind="dB-signed"
        precision={1}
        floorLabel="Off"
        disabled={!editable}
        onChange={(v) => setSubharmTop(s, v)}
      />
    {/if}

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

    {#if ext}
      <div class="rule"></div>
      <span class="section">SELECTIVITY</span>

      <span class="microlbl">MODE</span>
      <div class="span2">
        <SegmentedSelect
          value={selectMode}
          options={SELECT_MODE_OPTIONS}
          disabled={!editable}
          ariaLabel="Subharmonic selectivity mode"
          onChange={(v) => setSubharmSelectMode(s, v)}
        />
      </div>

      <LabeledSlider
        label="DEPTH"
        ariaLabel="Subharmonic selectivity depth"
        value={subharm?.selectDepth ?? 100}
        min={Proc.SUBHARM_DEPTH_MIN_PCT} max={Proc.SUBHARM_DEPTH_MAX_PCT} step={Proc.SUBHARM_DEPTH_STEP_PCT}
        kind="pct"
        precision={0}
        disabled={!selectivityEditable}
        onChange={(v) => setSubharmDepth(s, v)}
      />

      <LabeledSlider
        label="HOLD"
        ariaLabel="Subharmonic selectivity hold time"
        value={subharm?.selectHoldMs ?? 150}
        min={Proc.SUBHARM_HOLD_MIN_MS} max={Proc.SUBHARM_HOLD_MAX_MS} step={Proc.SUBHARM_HOLD_STEP_MS}
        kind="ms"
        precision={0}
        disabled={!selectivityEditable}
        onChange={(v) => setSubharmHold(s, v)}
      />

      <LabeledSlider
        label="CEILING"
        ariaLabel="Subharmonic sub ceiling"
        value={subharm?.ceilingDb ?? 0}
        min={Proc.SUBHARM_CEILING_MIN_DB} max={Proc.SUBHARM_CEILING_MAX_DB} step={Proc.SUBHARM_CEILING_STEP_DB}
        kind="dB-signed"
        precision={1}
        ceilLabel="Off"
        disabled={!editable}
        onChange={(v) => setSubharmCeiling(s, v)}
      />

      <span class="microlbl">LINK PAIRS</span>
      <div class="span2 linkpairs">
        <ToggleSwitch
          size="sm"
          checked={linkPairs}
          ariaLabel="Link subharm pairs"
          disabled={!editable}
          onChange={(v) => setSubharmLinkPairs(s, v)}
        />
        <p class="hint">one sub per stereo pair, from the mono sum</p>
      </div>

      <span class="microlbl">MONITOR</span>
      <div class="span2 monitor">
        <button
          type="button"
          class="chip warn"
          class:on={solo}
          aria-pressed={solo}
          aria-label="Monitor the synthesized sub only"
          disabled={!editable}
          onclick={() => setSubharmSolo(s, !solo)}
        >SOLO</button>
        {#if meter}
          <div class="meterbars" aria-hidden="true">
            {#each maskedOutputs as ch (ch.id)}
              <div class="meterrow">
                <span class="barname">{ch.name}</span>
                <div class="bar">
                  <span class="fill" style:width="{Math.round((meter[ch.index] ?? 0) * 100)}%"></span>
                </div>
              </div>
            {/each}
          </div>
        {/if}
        <p class="hint">solo is monitor-only and never saved</p>
      </div>
    {/if}

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

  .linkpairs { display: flex; align-items: center; gap: 8px; }

  .monitor { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }

  .meterbars { display: flex; flex-direction: column; gap: 3px; width: 100%; }
  .meterrow { display: flex; align-items: center; gap: 6px; }
  .barname {
    flex: 0 0 auto;
    width: 72px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-faint);
  }
  .bar {
    flex: 1;
    height: 5px;
    border-radius: 2px;
    background: var(--wash-strong);
    overflow: hidden;
  }
  .bar .fill {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 200ms;
  }
</style>
