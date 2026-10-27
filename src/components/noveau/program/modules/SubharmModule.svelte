<script lang="ts">
  import { untrack } from 'svelte';
  import SegmentedSelect from '@/components/chrome/SegmentedSelect.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import { Proc, SubharmSelect, outputChannelsWithIndex, maskChipItems, subharmReservePlan } from '@/domain';
  import * as Runtime from '@/runtime';
  import { getSession } from '@/components/sessionContext';
  import ModuleFrame from './ModuleFrame.svelte';
  import { formatSignedDb } from '@/components/chrome/format';
  import SliderField from '@/components/chrome/SliderField.svelte';
  import MaskChips from '@/components/chrome/MaskChips.svelte';

  const s = getSession();
  const snapshot = $derived(s.mirror.current);
  const sh = $derived(snapshot?.subharm);
  const enabled = $derived(sh?.enabled ?? false);

  const ext = $derived(s.device.capabilities.features.subharmExt);
  const selectMode = $derived(sh?.selectMode ?? SubharmSelect.All);
  const selectivityEditable = $derived(enabled && selectMode !== SubharmSelect.All);
  const offReason = $derived(enabled ? undefined : 'Subharmonic is off — enable it to edit these controls.');
  const selectivityReason = $derived(enabled && selectMode === SubharmSelect.All ? 'Selectivity mode is ALL — pick PERCUSSIVE or SUSTAINED to use depth and hold.' : undefined);
  const reason = $derived(offReason ?? selectivityReason);
  const solo = $derived(s.telemetry.subharmSolo);
  const meter = $derived(s.telemetry.subharmMeter);

  const SELECT_MODE_OPTIONS = [
    { value: SubharmSelect.All, label: 'ALL' },
    { value: SubharmSelect.Percussive, label: 'PERCUSSIVE' },
    { value: SubharmSelect.Sustained, label: 'SUSTAINED' },
  ] as const satisfies ReadonlyArray<{ value: SubharmSelect; label: string }>;

  const outputChannels = $derived(outputChannelsWithIndex(snapshot));
  const showMask = $derived(outputChannels.length > 1);
  const outputItems = $derived(maskChipItems(outputChannels, 'Output'));
  const outputMask = $derived(sh?.outputMask ?? 0xFFFF);
  const maskedOutputs = $derived(outputChannels.filter((ch) => (outputMask & (1 << ch.index)) !== 0));

  // Hold meter-poll interest while mounted and seed the solo mirror once.
  $effect(() => {
    if (!ext) return;
    const release = untrack(() => s.telemetry.wantSubharmMeter());
    void Runtime.fetchSubharmSolo(s);
    return release;
  });

  const rawHeadroomDb = $derived(s.telemetry.subharmHeadroomDb);
  const headroomDb = $derived(rawHeadroomDb !== null && Number.isFinite(rawHeadroomDb) ? rawHeadroomDb : null);
  const plan = $derived(snapshot ? subharmReservePlan(snapshot, headroomDb ?? 0) : []);
  const reserved = $derived(enabled && (headroomDb ?? 0) > 0 && plan.length === 0);
  const headroomText = $derived(headroomDb === null ? '—' : `${formatSignedDb(headroomDb)} dB`);
  const levelMax = $derived(Proc.subharmLevelMaxDb(ext));
</script>

<ModuleFrame
  title="Subharmonic"
  pass="per output · after matrix, before crossover"
  blurb="Octave divider: generates sub-bass one octave below the selected bands. Runs per output, before the crossover and Psybass."
  {enabled}
  onEnable={(v) => Runtime.setSubharmEnabled(s, v)}
  reason={offReason}
>
  {#if showMask}
    <MaskChips label="OUTPUTS" items={outputItems} mask={outputMask} disabled={!enabled}
      onToggle={(i) => Runtime.toggleSubharmOutputChannel(s, i)} />
  {/if}

  <SliderField lane="scrub" label="24–36 HZ" ariaLabel="Subharmonic 24 to 36 hertz band level" value={sh?.lowDb ?? Proc.SUBHARM_LEVEL_MIN_DB}
    min={Proc.SUBHARM_LEVEL_MIN_DB} max={levelMax} step={Proc.SUBHARM_LEVEL_STEP_DB}
    kind="dB-signed" precision={1} floorLabel="Off" disabled={!enabled} disabledReason={offReason} onChange={(v) => Runtime.setSubharmLow(s, v)} />
  <SliderField lane="scrub" label="36–56 HZ" ariaLabel="Subharmonic 36 to 56 hertz band level" value={sh?.highDb ?? Proc.SUBHARM_LEVEL_MIN_DB}
    min={Proc.SUBHARM_LEVEL_MIN_DB} max={levelMax} step={Proc.SUBHARM_LEVEL_STEP_DB}
    kind="dB-signed" precision={1} floorLabel="Off" disabled={!enabled} disabledReason={offReason} onChange={(v) => Runtime.setSubharmHigh(s, v)} />
  {#if ext}
    <SliderField lane="scrub" label="56–80 HZ" ariaLabel="Subharmonic 56 to 80 hertz band level" value={sh?.topDb ?? Proc.SUBHARM_LEVEL_MIN_DB}
      min={Proc.SUBHARM_LEVEL_MIN_DB} max={levelMax} step={Proc.SUBHARM_LEVEL_STEP_DB}
      kind="dB-signed" precision={1} floorLabel="Off" disabled={!enabled} disabledReason={offReason} onChange={(v) => Runtime.setSubharmTop(s, v)} />
  {/if}
  <SliderField lane="scrub" label="LF BOOST" ariaLabel="Subharmonic LF boost" value={sh?.boostDb ?? 0}
    min={Proc.SUBHARM_BOOST_MIN_DB} max={Proc.SUBHARM_BOOST_MAX_DB} step={Proc.SUBHARM_BOOST_STEP_DB}
    kind="dB" precision={1} disabled={!enabled} disabledReason={offReason} onChange={(v) => Runtime.setSubharmBoost(s, v)} />

  {#if ext}
    <div class="prow sub"><span>SELECTIVITY</span></div>
    <div class="prow">
      <span class="prow-lbl">MODE</span>
      <span class="prow-ctl"><SegmentedSelect value={selectMode} options={SELECT_MODE_OPTIONS} disabled={!enabled} disabledReason={offReason}
        ariaLabel="Subharmonic selectivity mode" onChange={(v) => Runtime.setSubharmSelectMode(s, v)} /></span>
    </div>
    <SliderField lane="scrub" label="DEPTH" ariaLabel="Subharmonic selectivity depth" value={sh?.selectDepth ?? 100}
      min={Proc.SUBHARM_DEPTH_MIN_PCT} max={Proc.SUBHARM_DEPTH_MAX_PCT} step={Proc.SUBHARM_DEPTH_STEP_PCT}
      kind="pct" precision={0} disabled={!selectivityEditable} disabledReason={reason} onChange={(v) => Runtime.setSubharmDepth(s, v)} />
    <SliderField lane="scrub" label="HOLD" ariaLabel="Subharmonic selectivity hold time" value={sh?.selectHoldMs ?? 150}
      min={Proc.SUBHARM_HOLD_MIN_MS} max={Proc.SUBHARM_HOLD_MAX_MS} step={Proc.SUBHARM_HOLD_STEP_MS}
      kind="ms" precision={0} disabled={!selectivityEditable} disabledReason={reason} onChange={(v) => Runtime.setSubharmHold(s, v)} />
    <SliderField lane="scrub" label="CEILING" ariaLabel="Subharmonic sub ceiling" value={sh?.ceilingDb ?? 0}
      min={Proc.SUBHARM_CEILING_MIN_DB} max={Proc.SUBHARM_CEILING_MAX_DB} step={Proc.SUBHARM_CEILING_STEP_DB}
      kind="dB-signed" precision={1} ceilLabel="Off" disabled={!enabled} disabledReason={offReason} onChange={(v) => Runtime.setSubharmCeiling(s, v)} />
    <div class="prow">
      <span class="prow-lbl">LINK PAIRS</span>
      <span class="prow-ctl">
        <ToggleSwitch checked={sh?.linkPairs ?? true} disabled={!enabled} disabledReason={offReason}
          ariaLabel="Link subharm pairs" onChange={(v) => Runtime.setSubharmLinkPairs(s, v)} />
        <span class="prow-note">one sub per stereo pair, from the mono sum</span>
      </span>
    </div>
    <div class="prow">
      <span class="prow-lbl">MONITOR</span>
      <span class="prow-ctl">
        <button type="button" class="chip warn" class:on={solo} aria-pressed={solo}
          aria-label="Monitor the synthesized sub only" disabled={!enabled}
          onclick={() => Runtime.setSubharmSolo(s, !solo)}>SOLO</button>
        <span class="prow-note">monitor only, never saved</span>
      </span>
    </div>
    {#if meter}
      <div class="prow" aria-hidden="true">
        <span class="prow-lbl">SUB LEVEL</span>
        <span class="meters">
          {#each maskedOutputs as ch (ch.id)}
            <span class="m" title={ch.name}>
              <span class="mn">{ch.index + 1}</span>
              <span class="bar"><span class="fill" style:width="{Math.round((meter[ch.index] ?? 0) * 100)}%"></span></span>
            </span>
          {/each}
        </span>
      </div>
    {/if}
  {/if}

  <div class="prow">
    <span class="prow-lbl">HEADROOM</span>
    <span class="prow-ctl">
      <span class="t-value">{headroomText}</span>
      {#if reserved}
        <span class="prow-note ok">RESERVED</span>
      {:else}
        <button type="button" class="chip accent" aria-label="Lower input preamps to reserve the subharmonic headroom"
          disabled={!enabled || plan.length === 0} onclick={() => Runtime.reserveSubharmHeadroom(s)}>RESERVE</button>
      {/if}
      {#if headroomDb !== null && headroomDb > 0}<span class="prow-note">input preamps ≤ {formatSignedDb(-headroomDb)} dB</span>{/if}
    </span>
  </div>
</ModuleFrame>

<style>
  .meters { display: inline-flex; gap: 6px; min-width: 0; }
  .m { display: inline-flex; align-items: center; gap: 3px; }
  .mn { font-family: var(--font-mono); font-size: 11px; color: var(--text-dim); }
  .bar { width: 20px; height: 5px; border-radius: var(--radius-xs); background: var(--wash-strong); overflow: hidden; }
  .fill { display: block; height: 100%; background: var(--accent); transition: width 200ms; }
  .prow-note.ok { color: var(--ok); font-weight: 700; }
</style>
