<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import PinSelect from './PinSelect.svelte';
  import { connection } from '@/state';
  import { applyCsBinding, clearCsBinding, applyCsName, csSaveConfig, csRevertConfig } from '@/runtime';
  import * as Domain from '@/domain';
  import { csStatusFromByte } from '@/protocol';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const connected = $derived(connection.connected);
  const snap = $derived(s.mirror.current);
  const cs = $derived(s.controlSurfaces);
  const caps = $derived(s.controlSurfaces.caps);
  const busy = $derived(!connected);

  // Per-slot local drafts (display units: unit-converted per noun -- dB/%/Q,
  // plain Hz, or ints for bool/enum; conversion happens once, in buildBinding).
  // A slot is "configured" when it has a live binding or a local draft; only
  // those render. Controls edit the draft; APPLY sends it.
  interface Draft {
    type: number; noun: number; action: number; event: number;
    gpio0: number; gpio1: number;
    target: number; index: number;
    invert: boolean; reverse: boolean; wrap: boolean; accel: boolean; repeat: boolean;
    value: number; step: number;
    limitRange: boolean; rangeMin: number; rangeMax: number;
  }
  const drafts = $state<Record<number, Draft>>({});
  const results = $state<Record<number, { ok: boolean; text: string } | null>>({});
  let applying = $state(false);

  const maxSlots = $derived(caps?.maxBindings ?? Domain.CS_MAX_BINDINGS);
  const visibleSlots = $derived(
    Array.from({ length: maxSlots }, (_, i) => i)
      .filter((i) => cs.bindings[i] != null || drafts[i] != null),
  );
  const allUsed = $derived(visibleSlots.length >= maxSlots);

  // The IR remote receiver is a separate future editor (learned commands, not
  // a plain type/noun/action binding); exclude it from the add-control list.
  const typeOptions = $derived(
    caps ? caps.types.map((_, i) => i).filter((i) => caps.types[i].pinCount > 0 && i !== Domain.CsType.Ir) : [],
  );

  const STEPPY: readonly number[] = [Domain.CsAction.Step, Domain.CsAction.Inc, Domain.CsAction.Dec];

  // Per-type action preference (desktop-app order); first legal one wins.
  const ACTION_PREF: Partial<Record<number, readonly Domain.CsAction[]>> = {
    [Domain.CsType.Pot]:     [Domain.CsAction.Adjust],
    [Domain.CsType.Encoder]: [Domain.CsAction.Step],
    [Domain.CsType.Switch]:  [Domain.CsAction.Follow],
    [Domain.CsType.Led]:     [Domain.CsAction.IndEquals],
    [Domain.CsType.LedPwm]:  [Domain.CsAction.IndLevel, Domain.CsAction.IndEquals],
    [Domain.CsType.Button]:  [Domain.CsAction.Toggle, Domain.CsAction.Trigger, Domain.CsAction.Inc, Domain.CsAction.Set, Domain.CsAction.Dec],
  };

  // Crossfeed voicing and leveller-speed enum labels (the CROSSFEED_PRESET/
  // LEVELLER_SPEED nouns don't identify curve names; same generic labels the
  // console's other Crossfeed/Leveller panels use).
  const CROSSFEED_PRESET_LABEL: Record<number, string> = {
    [Domain.CrossfeedPreset.Preset1]: 'Preset 1',
    [Domain.CrossfeedPreset.Preset2]: 'Preset 2',
    [Domain.CrossfeedPreset.Preset3]: 'Preset 3',
    [Domain.CrossfeedPreset.Custom]:  'Custom',
  };
  const LEVELLER_SPEED_LABEL: Record<number, string> = {
    [Domain.LevellerSpeed.Slow]:   'Slow',
    [Domain.LevellerSpeed.Medium]: 'Medium',
    [Domain.LevellerSpeed.Fast]:   'Fast',
  };
  const SAMPLE_RATE_LABEL: Record<number, string> = { 0: '44.1 kHz', 1: '48 kHz', 2: '96 kHz' };

  function nounOptionsFor(typeIdx: number): number[] {
    if (!caps) return [];
    const mask = caps.types[typeIdx]?.actions ?? 0;
    return cs.nouns.map((_, i) => i).filter((i) => (cs.nouns[i].actions & mask) !== 0);
  }

  function actionOptionsFor(typeIdx: number, nounIdx: number): Domain.CsAction[] {
    if (!caps) return [];
    return Domain.legalActions(caps.types[typeIdx]?.actions ?? 0, cs.nouns[nounIdx]?.actions ?? 0);
  }

  function kindOf(d: Draft): number { return cs.nouns[d.noun]?.kind ?? Domain.CsKind.Bool; }
  function contOf(d: Draft): boolean { return kindOf(d) === Domain.CsKind.Continuous; }
  function enumOf(d: Draft): boolean { return kindOf(d) === Domain.CsKind.Enum; }
  function unitOf(d: Draft): number { return cs.nouns[d.noun]?.unit ?? Domain.CS_UNIT_NONE; }
  function targetKindOf(d: Draft): number { return cs.nouns[d.noun]?.targetKind ?? Domain.CS_TARGET_NONE; }

  function showValueOf(d: Draft): boolean {
    return d.action === Domain.CsAction.Set || d.action === Domain.CsAction.IndEquals
      || d.action === Domain.CsAction.IndAbove || d.action === Domain.CsAction.Momentary;
  }
  function showStepOf(d: Draft): boolean { return STEPPY.includes(d.action); }
  function showRangeOf(d: Draft): boolean {
    return (d.action === Domain.CsAction.Adjust || d.action === Domain.CsAction.IndLevel) && contOf(d);
  }
  function showWrapOf(d: Draft): boolean { return enumOf(d) && STEPPY.includes(d.action); }
  function showReverseOf(d: Draft): boolean { return d.type === Domain.CsType.Pot || d.type === Domain.CsType.Encoder; }
  function showAccelOf(d: Draft): boolean { return d.type === Domain.CsType.Encoder; }
  function showRepeatOf(d: Draft): boolean {
    return d.type === Domain.CsType.Button && (d.action === Domain.CsAction.Inc || d.action === Domain.CsAction.Dec);
  }
  function showEventOf(d: Draft): boolean { return d.type === Domain.CsType.Button; }
  // MOMENTARY and REPEAT are only legal on the press event; lock the picker
  // there rather than let the user build an invalid combination.
  function eventLocked(d: Draft): boolean { return d.action === Domain.CsAction.Momentary || d.repeat; }
  function showTargetOf(d: Draft): boolean { return targetKindOf(d) !== Domain.CS_TARGET_NONE; }
  function showBandOf(d: Draft): boolean { return targetKindOf(d) === Domain.CS_TARGET_DSP_BAND; }
  function twoPins(d: Draft): boolean { return caps?.types[d.type]?.pinCount === 2; }
  function adcOnly(d: Draft): boolean { return caps?.types[d.type]?.pinClass === Domain.CS_PINCLASS_ADC; }

  function invertLabel(d: Draft): string {
    if (d.type === Domain.CsType.Led || d.type === Domain.CsType.LedPwm) return 'Active-low LED';
    if (showReverseOf(d)) return 'Pull-down wiring';
    return 'Active-high wiring';
  }

  function valueLabel(d: Draft): string {
    if (d.action === Domain.CsAction.IndEquals) return 'LIGHT WHEN';
    if (d.action === Domain.CsAction.IndAbove) return 'LIGHT WHEN ≥';
    if (d.action === Domain.CsAction.Momentary) return 'WHILE HELD';
    return contOf(d) ? 'TARGET LEVEL' : 'SET TO';
  }

  // Unit-aware conversion between the wire's 8.8/plain-int encoding and the
  // draft's display units (see domain/controlSurfaces.ts's q8 helpers). Hz is
  // a plain integer on the wire; step on a Hz/Q noun is an 8.8-octave size,
  // not the unit itself.
  function valueToDisplay(unit: number, q8: number): number {
    switch (unit) {
      case Domain.CS_UNIT_DB:      return Domain.q8ToDb(q8);
      case Domain.CS_UNIT_Q:       return Domain.q8ToQ(q8);
      case Domain.CS_UNIT_PERCENT: return Domain.q8ToPercent(q8);
      default:                     return q8;
    }
  }
  function displayToValue(unit: number, display: number): number {
    switch (unit) {
      case Domain.CS_UNIT_DB:      return Domain.dbToQ8(display);
      case Domain.CS_UNIT_Q:       return Domain.qToQ8(display);
      case Domain.CS_UNIT_PERCENT: return Domain.percentToQ8(display);
      default:                     return Math.round(display);
    }
  }
  function isLogStep(unit: number): boolean { return unit === Domain.CS_UNIT_HZ || unit === Domain.CS_UNIT_Q; }
  function stepToDisplay(unit: number, q8: number): number {
    return isLogStep(unit) ? Domain.q8StepToOctaves(q8) : valueToDisplay(unit, q8);
  }
  function displayToStep(unit: number, display: number): number {
    return isLogStep(unit) ? Domain.octavesToQ8Step(display) : displayToValue(unit, display);
  }
  function unitSuffix(unit: number): string {
    switch (unit) {
      case Domain.CS_UNIT_DB:      return 'dB';
      case Domain.CS_UNIT_PERCENT: return '%';
      case Domain.CS_UNIT_HZ:      return 'Hz';
      case Domain.CS_UNIT_Q:       return 'Q';
      default:                     return '';
    }
  }
  function stepUnitSuffix(unit: number): string { return isLogStep(unit) ? 'octaves' : unitSuffix(unit); }

  function boolValueOptions(d: Draft): { v: number; label: string }[] {
    const clip = d.noun === Domain.CsNoun.Clip;
    return [
      { v: 1, label: clip ? 'Clipping' : 'On' },
      { v: 0, label: clip ? 'Not clipping' : 'Off' },
    ];
  }

  function enumValueOptions(d: Draft): { v: number; label: string }[] {
    const count = cs.nouns[d.noun]?.enumCount ?? 0;
    const idx = Array.from({ length: count }, (_, i) => i);
    if (d.noun === Domain.CsNoun.Preset) {
      return idx.map((i) => {
        const name = s.presets.names[i];
        return { v: i, label: `Preset ${i + 1}${name ? ` · ${name}` : ''}` };
      });
    }
    if (d.noun === Domain.CsNoun.InputSource) {
      const names = ['USB', 'S/PDIF', 'I2S'];
      return idx.map((i) => ({ v: i, label: names[i] ?? String(i) }));
    }
    if (d.noun === Domain.CsNoun.CrossfeedPreset) return idx.map((i) => ({ v: i, label: CROSSFEED_PRESET_LABEL[i] ?? String(i) }));
    if (d.noun === Domain.CsNoun.LevellerSpeed) return idx.map((i) => ({ v: i, label: LEVELLER_SPEED_LABEL[i] ?? String(i) }));
    if (d.noun === Domain.CsNoun.SampleRate) return idx.map((i) => ({ v: i, label: SAMPLE_RATE_LABEL[i] ?? String(i) }));
    return idx.map((i) => ({ v: i, label: String(i) }));
  }

  // Target/band pickers. INPUT_CH/OUTPUT_CH index into the platform's input or
  // output channel list; DSP_CH/DSP_BAND index into the combined (inputs then
  // outputs) list, matching the firmware's addressing and snap.channels' order.
  function targetOptionsFor(d: Draft): { v: number; label: string }[] {
    if (!snap) return [];
    const kind = targetKindOf(d);
    const count = cs.nouns[d.noun]?.targetCount ?? 0;
    let opts: { v: number; label: string }[];
    switch (kind) {
      case Domain.CS_TARGET_INPUT_CH:
        opts = snap.channels.filter((c) => !c.isOutput).map((c, i) => ({ v: i, label: c.name }));
        break;
      case Domain.CS_TARGET_OUTPUT_CH:
        opts = snap.channels.filter((c) => c.isOutput).map((c, i) => ({ v: i, label: c.name }));
        break;
      case Domain.CS_TARGET_DSP_CH:
      case Domain.CS_TARGET_DSP_BAND:
        opts = snap.channels.map((c, i) => ({ v: i, label: c.name }));
        break;
      default:
        opts = [];
    }
    return opts.filter((o) => o.v < count);
  }

  // Valid bands for the selected channel: PEQ bands 1..bandCount, plus (only
  // for FILTER_FREQ/FILTER_BYPASS, output channels only) the crossover bands
  // at wire indices XOVER_BAND_BASE.. (see control_surfaces_spec.md 4.4).
  function bandOptionsFor(d: Draft): { v: number; label: string }[] {
    if (!snap) return [];
    const ch = snap.channels[d.target];
    if (!ch) return [];
    const opts: { v: number; label: string }[] = [];
    for (let i = 0; i < ch.bandCount; i++) opts.push({ v: i, label: `Band ${i + 1}` });
    const allowsXover = d.noun === Domain.CsNoun.FilterFreq || d.noun === Domain.CsNoun.FilterBypass;
    if (allowsXover && ch.isOutput) {
      for (let i = 0; i < ch.xoverBands.length; i++) opts.push({ v: Domain.XOVER_BAND_BASE + i, label: `XO ${i + 1}` });
    }
    return opts;
  }

  // Only LIVE sibling bindings reserve pins (fw control_surfaces_owns_pin);
  // the edited slot's own pins stay selectable.
  function otherCsPins(slot: number): ({ gpio0: number; gpio1: number | null } | null)[] {
    return Domain.liveCsPinConfigs(cs.bindings, cs.status).map((p, i) => (i === slot ? null : p));
  }

  function candidatesFor(slot: number, selfPin: number, adc: boolean, excludePin?: number): Domain.PinCandidate[] {
    if (!snap) return [];
    let cands = Domain.availablePinsFor(snap.platform.type, snap, selfPin, {
      uart: s.ctrlIfaces.uart, i2c: s.ctrlIfaces.i2c, cs: otherCsPins(slot),
    });
    if (adc) cands = cands.filter((c) => Domain.CS_ADC_PINS.includes(c.pin));
    if (excludePin != null) cands = cands.filter((c) => c.pin !== excludePin);
    return cands;
  }

  function firstFree(cands: Domain.PinCandidate[]): number {
    return cands.find((c) => c.usedBy === null)?.pin ?? cands[0]?.pin ?? 0;
  }

  function defaultAction(typeIdx: number, nounIdx: number): number {
    const legal = actionOptionsFor(typeIdx, nounIdx);
    for (const a of ACTION_PREF[typeIdx] ?? []) if (legal.includes(a)) return a;
    return legal[0] ?? 0;
  }

  function defaultOperands(d: Draft): void {
    const noun = cs.nouns[d.noun];
    const cont = noun?.kind === Domain.CsKind.Continuous;
    const bool = noun?.kind === Domain.CsKind.Bool;
    const unit = noun?.unit ?? Domain.CS_UNIT_NONE;
    d.step = !STEPPY.includes(d.action) ? 0 : isLogStep(unit) ? 0 : 1;   // 0 = firmware default (1/12 octave); else 1 unit/position
    if (d.action === Domain.CsAction.Set || d.action === Domain.CsAction.Momentary) {
      d.value = noun && cont ? valueToDisplay(unit, noun.maxQ8) : bool ? 1 : 0;
    } else if (d.action === Domain.CsAction.IndEquals) {
      d.value = bool ? 1 : 0;
    } else if (d.action === Domain.CsAction.IndAbove) {
      d.value = noun && cont ? valueToDisplay(unit, noun.maxQ8) : 0;
    } else {
      d.value = 0;
    }
    d.limitRange = false;
    d.rangeMin = noun && cont ? valueToDisplay(unit, noun.minQ8) : 0;
    d.rangeMax = noun && cont ? valueToDisplay(unit, noun.maxQ8) : 0;
  }

  function defaultDraft(typeIdx: number, slot: number): Draft {
    const noun = nounOptionsFor(typeIdx)[0] ?? Domain.CsNoun.MasterVolume;
    const d: Draft = {
      type: typeIdx, noun, action: defaultAction(typeIdx, noun), event: Domain.CsEvent.Press,
      gpio0: 0, gpio1: 0, target: 0, index: 0,
      invert: false, reverse: false, wrap: false, accel: false, repeat: false,
      value: 0, step: 0, limitRange: false, rangeMin: 0, rangeMax: 0,
    };
    d.gpio0 = firstFree(candidatesFor(slot, -1, adcOnly(d)));
    if (twoPins(d)) d.gpio1 = firstFree(candidatesFor(slot, -1, false, d.gpio0));
    defaultOperands(d);
    return d;
  }

  function draftFromLive(b: Domain.CsBinding): Draft {
    const noun = cs.nouns[b.noun];
    const cont = noun?.kind === Domain.CsKind.Continuous;
    const unit = noun?.unit ?? Domain.CS_UNIT_NONE;
    const limited = b.rangeMin !== 0 || b.rangeMax !== 0;
    return {
      type: b.type, noun: b.noun, action: b.action, event: b.event,
      gpio0: b.gpio0, gpio1: b.gpio1 ?? 0,
      target: b.target, index: b.index,
      invert: (b.flags & Domain.CS_FLAG_INVERT) !== 0,
      reverse: (b.flags & Domain.CS_FLAG_REVERSE) !== 0,
      wrap: (b.flags & Domain.CS_FLAG_WRAP) !== 0,
      accel: (b.flags & Domain.CS_FLAG_ACCEL) !== 0,
      repeat: (b.flags & Domain.CS_FLAG_REPEAT) !== 0,
      value: cont ? valueToDisplay(unit, b.value) : b.value,
      step: cont ? stepToDisplay(unit, b.step) : b.step,
      limitRange: limited,
      rangeMin: cont ? valueToDisplay(unit, limited ? b.rangeMin : noun?.minQ8 ?? 0) : 0,
      rangeMax: cont ? valueToDisplay(unit, limited ? b.rangeMax : noun?.maxQ8 ?? 0) : 0,
    };
  }

  function draftOf(slot: number): Draft {
    return drafts[slot] ?? draftFromLive(cs.bindings[slot]!);
  }

  function editDraft(slot: number, fn: (d: Draft) => void): void {
    const d = drafts[slot] ?? draftFromLive(cs.bindings[slot]!);
    fn(d);
    drafts[slot] = d;
    results[slot] = null;
  }

  function buildBinding(d: Draft): Domain.CsBinding {
    const cont = contOf(d);
    const unit = unitOf(d);
    const forcedPress = d.action === Domain.CsAction.Momentary || d.repeat;
    const event = d.type === Domain.CsType.Button ? (forcedPress ? Domain.CsEvent.Press : (d.event as Domain.CsEvent)) : Domain.CsEvent.Press;
    return {
      type: d.type as Domain.CsType,
      noun: d.noun as Domain.CsNoun,
      action: d.action as Domain.CsAction,
      flags: (d.invert ? Domain.CS_FLAG_INVERT : 0)
        | (showReverseOf(d) && d.reverse ? Domain.CS_FLAG_REVERSE : 0)
        | (showWrapOf(d) && d.wrap ? Domain.CS_FLAG_WRAP : 0)
        | (showAccelOf(d) && d.accel ? Domain.CS_FLAG_ACCEL : 0)
        | (showRepeatOf(d) && d.repeat ? Domain.CS_FLAG_REPEAT : 0),
      gpio0: d.gpio0,
      gpio1: twoPins(d) ? d.gpio1 : null,
      event,
      target: showTargetOf(d) ? d.target : 0,
      index: showBandOf(d) ? d.index : 0,
      value: showValueOf(d) ? (cont ? displayToValue(unit, d.value) : Math.round(d.value)) : 0,
      step: showStepOf(d) ? (cont ? displayToStep(unit, d.step) : Math.round(d.step)) : 0,
      rangeMin: showRangeOf(d) && d.limitRange ? displayToValue(unit, d.rangeMin) : 0,
      rangeMax: showRangeOf(d) && d.limitRange ? displayToValue(unit, d.rangeMax) : 0,
    };
  }

  function bindingsEqual(a: Domain.CsBinding, b: Domain.CsBinding): boolean {
    return a.type === b.type && a.noun === b.noun && a.action === b.action
      && a.flags === b.flags && a.gpio0 === b.gpio0
      && (a.gpio1 ?? null) === (b.gpio1 ?? null)
      && a.event === b.event && a.target === b.target && a.index === b.index
      && a.value === b.value && a.step === b.step
      && a.rangeMin === b.rangeMin && a.rangeMax === b.rangeMax;
  }

  function isDirty(slot: number): boolean {
    const live = cs.bindings[slot];
    if (!live) return true;                        // NEW: never applied
    const d = drafts[slot];
    if (!d) return false;
    return !bindingsEqual(buildBinding(d), live);
  }

  function pill(slot: number): { text: string; cls: string } {
    const live = cs.bindings[slot];
    if (!live) return { text: 'NEW', cls: 'new' };
    if (cs.status && (cs.status.activeMask & (1 << slot))) return { text: 'ACTIVE', cls: 'ok' };
    return { text: 'INACTIVE', cls: 'warn' };
  }

  function statusText(byte: number): string {
    const r = csStatusFromByte(byte);
    return r.ok ? 'Applied — unsaved' : r.message;
  }

  function inactiveHint(slot: number): string {
    const byte = cs.status?.slotStatus[slot] ?? 0;
    const r = csStatusFromByte(byte);
    const why = r.ok ? 'failed to apply the binding' : r.message.toLowerCase();
    return `Not running: ${why}. Reassign the conflicting pin, then apply.`;
  }

  function failText(): string {
    return statusText(cs.status?.lastStatus ?? 0xFF);
  }

  function firstFreeSlot(): number | null {
    for (let i = 0; i < maxSlots; i++) {
      if (!cs.bindings[i] && !drafts[i]) return i;
    }
    return null;
  }

  function addControl(e: Event): void {
    const sel = e.currentTarget as HTMLSelectElement;
    const typeIdx = Number(sel.value);
    sel.value = '';
    if (Number.isNaN(typeIdx)) return;
    const slot = firstFreeSlot();
    if (slot == null) return;
    drafts[slot] = defaultDraft(typeIdx, slot);
    results[slot] = null;
  }

  async function apply(slot: number): Promise<void> {
    const live = cs.bindings[slot];
    const d = drafts[slot] ?? (live ? draftFromLive(live) : null);
    if (!d) return;
    applying = true;
    try {
      const ok = await applyCsBinding(s, slot, buildBinding(d));
      if (ok) {
        delete drafts[slot];                       // device truth takes over
        results[slot] = { ok: true, text: 'Applied — unsaved' };
      } else {
        results[slot] = { ok: false, text: failText() };
      }
    } finally {
      applying = false;
    }
  }

  function revert(slot: number): void {
    delete drafts[slot];
    results[slot] = null;
  }

  // Remove = drop a never-applied draft locally; clear a live slot on the
  // device (the all-zero binding).
  async function remove(slot: number): Promise<void> {
    results[slot] = null;
    if (!cs.bindings[slot]) { delete drafts[slot]; return; }
    applying = true;
    try {
      const ok = await clearCsBinding(s, slot);
      if (ok) { delete drafts[slot]; delete results[slot]; }
      else results[slot] = { ok: false, text: failText() };
    } finally {
      applying = false;
    }
  }

  async function renameSlot(slot: number, name: string): Promise<void> {
    applying = true;
    try {
      await applyCsName(s, slot, name);
    } finally {
      applying = false;
    }
  }

  async function saveConfig(): Promise<void> {
    applying = true;
    try {
      await csSaveConfig(s);
    } finally {
      applying = false;
    }
  }

  async function discardConfig(): Promise<void> {
    applying = true;
    try {
      await csRevertConfig(s);
      // The device just rewound every slot to its stored state; local drafts
      // and per-slot results no longer describe anything real.
      for (const key of Object.keys(drafts)) delete drafts[Number(key)];
      for (const key of Object.keys(results)) delete results[Number(key)];
    } finally {
      applying = false;
    }
  }

  function num(e: Event): number | null {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    return Number.isNaN(v) ? null : v;
  }
</script>

<Panel code="CT.02" title="CONTROL SURFACES">
  {#if caps}
    {#if cs.status?.dirty}
      <div class="dirtybar">
        <span class="dirtytext">UNSAVED CHANGES — live preview, not yet written to flash</span>
        <div class="dirtyactions">
          <button type="button" class="chip accent" disabled={applying} onclick={saveConfig}>SAVE</button>
          <button type="button" class="chip hi" disabled={applying} onclick={discardConfig}>DISCARD</button>
        </div>
      </div>
    {/if}

    {#if visibleSlots.length === 0}
      <div class="hint pad empty">
        No controls configured. Wire a button, switch, knob, encoder, or LED to a
        spare GPIO and bind it to a device function.
      </div>
    {/if}

    {#each visibleSlots as slot (slot)}
      {@const d = draftOf(slot)}
      {@const p = pill(slot)}
      {@const actions = actionOptionsFor(d.type, d.noun)}
      <div class="slot">
        <div class="slothead">
          <span class="stitle">{Domain.CS_TYPE_LABEL[d.type as Domain.CsType].toUpperCase()}</span>
          <input class="nameinput" type="text" maxlength="31" placeholder="Unnamed"
            value={cs.names[slot] ?? ''} aria-label={`Name for control ${slot + 1}`}
            disabled={busy || applying}
            onchange={(e) => renameSlot(slot, (e.currentTarget as HTMLInputElement).value)} />
          <span class="pill {p.cls}">{p.text}</span>
          {#if cs.bindings[slot] && isDirty(slot)}
            <span class="dirty">Unapplied changes</span>
          {/if}
          <span class="spacer"></span>
          <button type="button" class="x" aria-label={`Remove control ${slot + 1}`}
            disabled={applying} onclick={() => remove(slot)}>✕</button>
        </div>

        {#if p.cls === 'warn'}
          <div class="hint err srow">{inactiveHint(slot)}</div>
        {/if}

        <div class="rows">
          <div class="row">
            <span class="microlbl">TYPE</span>
            <select class="sel" value={String(d.type)} aria-label="Component type" disabled={busy || applying}
              onchange={(e) => {
                const t = Number((e.currentTarget as HTMLSelectElement).value);
                drafts[slot] = defaultDraft(t, slot);
                results[slot] = null;
              }}>
              {#each typeOptions as t (t)}
                <option value={String(t)}>{Domain.CS_TYPE_LABEL[t as Domain.CsType]}</option>
              {/each}
            </select>
            <span class="microlbl">CONTROLS</span>
            <select class="sel" value={String(d.noun)} aria-label="Controlled function" disabled={busy || applying}
              onchange={(e) => {
                const n = Number((e.currentTarget as HTMLSelectElement).value);
                editDraft(slot, (dr) => {
                  dr.noun = n;
                  dr.target = 0;
                  dr.index = 0;
                  const legal = actionOptionsFor(dr.type, n);
                  if (!legal.includes(dr.action as Domain.CsAction)) dr.action = defaultAction(dr.type, n);
                  defaultOperands(dr);
                  if (dr.action === Domain.CsAction.Momentary) dr.event = Domain.CsEvent.Press;
                });
              }}>
              {#each nounOptionsFor(d.type) as n (n)}
                <option value={String(n)}>{Domain.CS_NOUN_LABEL[n as Domain.CsNoun]}</option>
              {/each}
            </select>
          </div>

          {#if actions.length > 1 || showEventOf(d)}
            <div class="row">
              {#if actions.length > 1}
                <span class="microlbl">ON PRESS</span>
                <select class="sel" value={String(d.action)} aria-label="Action" disabled={busy || applying}
                  onchange={(e) => {
                    const a = Number((e.currentTarget as HTMLSelectElement).value);
                    editDraft(slot, (dr) => {
                      dr.action = a;
                      defaultOperands(dr);
                      if (dr.action === Domain.CsAction.Momentary) dr.event = Domain.CsEvent.Press;
                      if (dr.action !== Domain.CsAction.Inc && dr.action !== Domain.CsAction.Dec) dr.repeat = false;
                    });
                  }}>
                  {#each actions as a (a)}
                    <option value={String(a)}>{Domain.csActionLabel(a, enumOf(d))}</option>
                  {/each}
                </select>
              {/if}
              {#if showEventOf(d)}
                <span class="microlbl">GESTURE</span>
                <select class="sel" value={String(d.event)} aria-label="Button gesture"
                  disabled={busy || applying || eventLocked(d)}
                  onchange={(e) => { const v = Number((e.currentTarget as HTMLSelectElement).value); editDraft(slot, (dr) => { dr.event = v; }); }}>
                  {#each [Domain.CsEvent.Press, Domain.CsEvent.Long, Domain.CsEvent.Double] as ev (ev)}
                    <option value={String(ev)}>{Domain.CS_EVENT_LABEL[ev as Domain.CsEvent]}</option>
                  {/each}
                </select>
                {#if eventLocked(d)}
                  <span class="hint">(forced to Press)</span>
                {/if}
              {/if}
            </div>
          {/if}

          <div class="row">
            {#if twoPins(d)}
              <span class="microlbl">GPIO A</span>
              <PinSelect value={d.gpio0} candidates={candidatesFor(slot, d.gpio0, false, d.gpio1)}
                ariaLabel="Encoder GPIO A" disabled={busy || applying}
                onChange={(pin) => editDraft(slot, (dr) => { dr.gpio0 = pin; })} />
              <span class="microlbl">GPIO B</span>
              <PinSelect value={d.gpio1} candidates={candidatesFor(slot, d.gpio1, false, d.gpio0)}
                ariaLabel="Encoder GPIO B" disabled={busy || applying}
                onChange={(pin) => editDraft(slot, (dr) => { dr.gpio1 = pin; })} />
            {:else}
              <span class="microlbl">GPIO</span>
              <PinSelect value={d.gpio0} candidates={candidatesFor(slot, d.gpio0, adcOnly(d))}
                ariaLabel="Control GPIO" disabled={busy || applying}
                onChange={(pin) => editDraft(slot, (dr) => { dr.gpio0 = pin; })} />
            {/if}
          </div>

          {#if showTargetOf(d)}
            <div class="row">
              <span class="microlbl">{targetKindOf(d) === Domain.CS_TARGET_INPUT_CH ? 'INPUT' : targetKindOf(d) === Domain.CS_TARGET_OUTPUT_CH ? 'OUTPUT' : 'CHANNEL'}</span>
              <select class="sel" value={String(d.target)} aria-label="Target channel" disabled={busy || applying}
                onchange={(e) => { const v = Number((e.currentTarget as HTMLSelectElement).value); editDraft(slot, (dr) => { dr.target = v; dr.index = 0; }); }}>
                {#each targetOptionsFor(d) as o (o.v)}
                  <option value={String(o.v)}>{o.label}</option>
                {/each}
              </select>
              {#if showBandOf(d)}
                <span class="microlbl">BAND</span>
                <select class="sel" value={String(d.index)} aria-label="Filter band" disabled={busy || applying}
                  onchange={(e) => { const v = Number((e.currentTarget as HTMLSelectElement).value); editDraft(slot, (dr) => { dr.index = v; }); }}>
                  {#each bandOptionsFor(d) as o (o.v)}
                    <option value={String(o.v)}>{o.label}</option>
                  {/each}
                </select>
              {/if}
            </div>
          {/if}

          {#if showValueOf(d) || showStepOf(d)}
            <div class="row">
              {#if showValueOf(d)}
                <span class="microlbl">{valueLabel(d)}</span>
                {#if contOf(d)}
                  <input class="numfield" type="number" step="0.5"
                    min={cs.nouns[d.noun] ? valueToDisplay(unitOf(d), cs.nouns[d.noun].minQ8) : 0}
                    max={cs.nouns[d.noun] ? valueToDisplay(unitOf(d), cs.nouns[d.noun].maxQ8) : 0}
                    value={d.value} aria-label={`${valueLabel(d)} (${unitSuffix(unitOf(d))})`} disabled={busy || applying}
                    onchange={(e) => { const v = num(e); if (v != null) editDraft(slot, (dr) => { dr.value = v; }); }} />
                  <span class="hint">{unitSuffix(unitOf(d))}</span>
                {:else}
                  <select class="sel" value={String(d.value)} aria-label={valueLabel(d)} disabled={busy || applying}
                    onchange={(e) => { const v = Number((e.currentTarget as HTMLSelectElement).value); editDraft(slot, (dr) => { dr.value = v; }); }}>
                    {#each (enumOf(d) ? enumValueOptions(d) : boolValueOptions(d)) as o (o.v)}
                      <option value={String(o.v)}>{o.label}</option>
                    {/each}
                  </select>
                {/if}
              {/if}
              {#if showStepOf(d)}
                <span class="microlbl">STEP SIZE</span>
                {#if enumOf(d)}
                  <input class="numfield" type="number" step="1" min="1"
                    max={Math.max(1, (cs.nouns[d.noun]?.enumCount ?? 2) - 1)}
                    value={d.step} aria-label="Step size (positions)" disabled={busy || applying}
                    onchange={(e) => { const v = num(e); if (v != null) editDraft(slot, (dr) => { dr.step = v; }); }} />
                {:else}
                  <input class="numfield" type="number" step={isLogStep(unitOf(d)) ? '0.01' : '0.5'} min="0"
                    value={d.step} aria-label={`Step size (${stepUnitSuffix(unitOf(d))})`} disabled={busy || applying}
                    onchange={(e) => { const v = num(e); if (v != null) editDraft(slot, (dr) => { dr.step = v; }); }} />
                  <span class="hint">{stepUnitSuffix(unitOf(d))}</span>
                {/if}
              {/if}
            </div>
          {/if}

          {#if showRangeOf(d)}
            <div class="row">
              <span class="microlbl">LIMIT RANGE</span>
              <ToggleSwitch size="sm" checked={d.limitRange} disabled={busy || applying}
                ariaLabel="Limit the range"
                onChange={(v) => editDraft(slot, (dr) => { dr.limitRange = v; })} />
              {#if d.limitRange}
                <span class="microlbl">MINIMUM</span>
                <input class="numfield" type="number" step="0.5"
                  min={cs.nouns[d.noun] ? valueToDisplay(unitOf(d), cs.nouns[d.noun].minQ8) : 0}
                  max={cs.nouns[d.noun] ? valueToDisplay(unitOf(d), cs.nouns[d.noun].maxQ8) : 0}
                  value={d.rangeMin} aria-label={`Range minimum (${unitSuffix(unitOf(d))})`} disabled={busy || applying}
                  onchange={(e) => { const v = num(e); if (v != null) editDraft(slot, (dr) => { dr.rangeMin = v; }); }} />
                <span class="microlbl">MAXIMUM</span>
                <input class="numfield" type="number" step="0.5"
                  min={cs.nouns[d.noun] ? valueToDisplay(unitOf(d), cs.nouns[d.noun].minQ8) : 0}
                  max={cs.nouns[d.noun] ? valueToDisplay(unitOf(d), cs.nouns[d.noun].maxQ8) : 0}
                  value={d.rangeMax} aria-label={`Range maximum (${unitSuffix(unitOf(d))})`} disabled={busy || applying}
                  onchange={(e) => { const v = num(e); if (v != null) editDraft(slot, (dr) => { dr.rangeMax = v; }); }} />
                <span class="hint">{unitSuffix(unitOf(d))}</span>
              {/if}
            </div>
          {/if}

          <div class="row">
            <span class="microlbl">{invertLabel(d).toUpperCase()}</span>
            <ToggleSwitch size="sm" checked={d.invert} disabled={busy || applying}
              ariaLabel={invertLabel(d)}
              onChange={(v) => editDraft(slot, (dr) => { dr.invert = v; })} />
            {#if showReverseOf(d)}
              <span class="microlbl">REVERSE DIRECTION</span>
              <ToggleSwitch size="sm" checked={d.reverse} disabled={busy || applying}
                ariaLabel="Reverse direction"
                onChange={(v) => editDraft(slot, (dr) => { dr.reverse = v; })} />
            {/if}
            {#if showWrapOf(d)}
              <span class="microlbl">WRAP AROUND</span>
              <ToggleSwitch size="sm" checked={d.wrap} disabled={busy || applying}
                ariaLabel="Wrap around"
                onChange={(v) => editDraft(slot, (dr) => { dr.wrap = v; })} />
            {/if}
            {#if showAccelOf(d)}
              <span class="microlbl">ACCELERATE FAST ROTATION</span>
              <ToggleSwitch size="sm" checked={d.accel} disabled={busy || applying}
                ariaLabel="Accelerate on fast rotation"
                onChange={(v) => editDraft(slot, (dr) => { dr.accel = v; })} />
            {/if}
            {#if showRepeatOf(d)}
              <span class="microlbl">AUTO-REPEAT WHILE HELD</span>
              <ToggleSwitch size="sm" checked={d.repeat} disabled={busy || applying}
                ariaLabel="Auto-repeat while held"
                onChange={(v) => editDraft(slot, (dr) => { dr.repeat = v; if (v) dr.event = Domain.CsEvent.Press; })} />
            {/if}
          </div>

          <div class="row">
            <button type="button" class="chip accent" onclick={() => apply(slot)}
              disabled={busy || applying || !isDirty(slot)}>APPLY</button>
            <button type="button" class="chip hi" onclick={() => revert(slot)}
              disabled={applying || !cs.bindings[slot] || !isDirty(slot)}>REVERT</button>
          </div>
          {#if results[slot] != null}
            {@const r = results[slot]!}
            <div class="hint result" class:err={!r.ok} class:ok={r.ok}>{r.text}</div>
          {/if}
        </div>
      </div>
    {/each}

    <div class="addrow">
      <select class="sel" value="" aria-label="Add control" disabled={busy || applying || allUsed} onchange={addControl}>
        <option value="" disabled>ADD CONTROL…</option>
        {#each typeOptions as t (t)}
          <option value={String(t)}>{Domain.CS_TYPE_LABEL[t as Domain.CsType]}</option>
        {/each}
      </select>
      {#if allUsed}
        <span class="hint">All {maxSlots} control slots are in use.</span>
      {/if}
    </div>

  {:else if cs.lastFetchError}
    <div class="hint err pad">{cs.lastFetchError}</div>
  {:else}
    <div class="hint pad">Reading control-surface capabilities…</div>
  {/if}
</Panel>

<style>
  .dirtybar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    padding: 8px 14px;
    background: color-mix(in oklab, var(--accent) 8%, transparent);
    border-bottom: 1px solid color-mix(in oklab, var(--accent) 30%, var(--border));
    font-family: var(--font-mono);
    font-size: 10px;
  }
  .dirtytext { flex: 1; min-width: 200px; color: var(--accent); font-weight: 700; letter-spacing: 0.6px; }
  .dirtyactions { display: flex; gap: 6px; flex: none; }
  .slot { border-bottom: 1px solid var(--wash); }
  .slothead {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px 0;
    font-family: var(--font-mono);
  }
  .stitle {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1.2px;
    color: var(--text-dim);
  }
  .nameinput {
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 2px 6px;
    width: 130px;
    background: var(--panel-solid);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .nameinput:disabled { opacity: var(--dim-disabled); }
  .pill {
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 1px;
    padding: 1px 6px;
    border-radius: 999px;
    border: 1px solid var(--border-hi);
  }
  .pill.new  { color: var(--accent); border-color: color-mix(in oklab, var(--accent) 50%, transparent); }
  .pill.ok   { color: var(--ok);     border-color: color-mix(in oklab, var(--ok) 50%, transparent); }
  .pill.warn { color: var(--warn);   border-color: color-mix(in oklab, var(--warn) 50%, transparent); }
  .dirty { font-size: 9px; color: var(--accent); }
  .spacer { flex: 1; }
  .x {
    background: none;
    border: none;
    color: var(--text-faint);
    cursor: pointer;
    padding: 0;
    font-size: 9px;
    line-height: 1;
  }
  .x:hover:not(:disabled) { color: var(--err); }
  .x:disabled { opacity: var(--dim-disabled); cursor: default; }
  .rows { padding: 6px 14px 10px; display: flex; flex-direction: column; gap: 8px; }
  .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .srow { padding: 4px 14px 0; }
  .sel {
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 3px 6px;
    background: var(--panel-solid);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
  }
  .sel:disabled { opacity: var(--dim-disabled); cursor: default; }
  .numfield {
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 3px 6px;
    width: 64px;
  }
  .result.ok { color: var(--ok); }
  .hint.err { color: var(--err); }
  .addrow { display: flex; align-items: center; gap: 10px; padding: 10px 14px 12px; }
  .empty { text-align: center; padding-top: 14px; }
  .pad { padding: 10px 14px; }
</style>
