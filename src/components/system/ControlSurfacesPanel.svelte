<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import PinSelect from './PinSelect.svelte';
  import { connection } from '@/state';
  import { applyCsBinding, clearCsBinding } from '@/runtime';
  import * as Domain from '@/domain';
  import { csStatusFromByte } from '@/protocol';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const connected = $derived(connection.connected);
  const snap = $derived(s.mirror.current);
  const cs = $derived(s.controlSurfaces);
  const caps = $derived(s.controlSurfaces.caps);
  const busy = $derived(!connected);

  // Per-slot local drafts (display units: dB for continuous nouns, ints for
  // bool/enum; q8.8 conversion happens once, in buildBinding). A slot is
  // "configured" when it has a live binding or a local draft; only those
  // render. Controls edit the draft; APPLY sends it.
  interface Draft {
    type: number; noun: number; action: number;
    gpio0: number; gpio1: number;
    invert: boolean; reverse: boolean; wrap: boolean;
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

  const typeOptions = $derived(
    caps ? caps.types.map((_, i) => i).filter((i) => caps.types[i].pinCount > 0) : [],
  );

  const STEPPY: readonly number[] = [Domain.CsAction.Step, Domain.CsAction.Inc, Domain.CsAction.Dec];

  // Per-type action preference (desktop-app order); first legal one wins.
  const ACTION_PREF: Partial<Record<number, readonly Domain.CsAction[]>> = {
    [Domain.CsType.Pot]:     [Domain.CsAction.Adjust],
    [Domain.CsType.Encoder]: [Domain.CsAction.Step],
    [Domain.CsType.Switch]:  [Domain.CsAction.Follow],
    [Domain.CsType.Led]:     [Domain.CsAction.IndEquals],
    [Domain.CsType.Button]:  [Domain.CsAction.Toggle, Domain.CsAction.Trigger, Domain.CsAction.Inc, Domain.CsAction.Set, Domain.CsAction.Dec],
  };

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
  function showValueOf(d: Draft): boolean { return d.action === Domain.CsAction.Set || d.action === Domain.CsAction.IndEquals; }
  function showStepOf(d: Draft): boolean { return STEPPY.includes(d.action); }
  function showRangeOf(d: Draft): boolean { return d.action === Domain.CsAction.Adjust && contOf(d); }
  function showWrapOf(d: Draft): boolean { return enumOf(d) && STEPPY.includes(d.action); }
  function showReverseOf(d: Draft): boolean { return d.type === Domain.CsType.Pot || d.type === Domain.CsType.Encoder; }
  function twoPins(d: Draft): boolean { return caps?.types[d.type]?.pinCount === 2; }
  function adcOnly(d: Draft): boolean { return caps?.types[d.type]?.pinClass === Domain.CS_PINCLASS_ADC; }

  function invertLabel(d: Draft): string {
    if (d.type === Domain.CsType.Led) return 'Active-low LED';
    if (showReverseOf(d)) return 'Pull-down wiring';
    return 'Active-high wiring';
  }

  function valueLabel(d: Draft): string {
    if (d.action === Domain.CsAction.IndEquals) return 'LIGHT WHEN';
    return contOf(d) ? 'TARGET LEVEL' : 'SET TO';
  }

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
    return idx.map((i) => ({ v: i, label: String(i) }));
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
    d.step = STEPPY.includes(d.action) ? 1 : 0;   // 1.0 dB or 1 position
    if (d.action === Domain.CsAction.Set) {
      d.value = noun && cont ? Domain.q8ToDb(noun.maxQ8) : bool ? 1 : 0;
    } else if (d.action === Domain.CsAction.IndEquals) {
      d.value = bool ? 1 : 0;
    } else {
      d.value = 0;
    }
    d.limitRange = false;
    d.rangeMin = noun && cont ? Domain.q8ToDb(noun.minQ8) : 0;
    d.rangeMax = noun && cont ? Domain.q8ToDb(noun.maxQ8) : 0;
  }

  function defaultDraft(typeIdx: number, slot: number): Draft {
    const noun = nounOptionsFor(typeIdx)[0] ?? Domain.CsNoun.MasterVolume;
    const d: Draft = {
      type: typeIdx, noun, action: defaultAction(typeIdx, noun),
      gpio0: 0, gpio1: 0,
      invert: false, reverse: false, wrap: false,
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
    const limited = b.rangeMin !== 0 || b.rangeMax !== 0;
    return {
      type: b.type, noun: b.noun, action: b.action,
      gpio0: b.gpio0, gpio1: b.gpio1 ?? 0,
      invert: (b.flags & Domain.CS_FLAG_INVERT) !== 0,
      reverse: (b.flags & Domain.CS_FLAG_REVERSE) !== 0,
      wrap: (b.flags & Domain.CS_FLAG_WRAP) !== 0,
      value: cont ? Domain.q8ToDb(b.value) : b.value,
      step: cont ? Domain.q8ToDb(b.step) : b.step,
      limitRange: limited,
      rangeMin: cont ? Domain.q8ToDb(limited ? b.rangeMin : noun?.minQ8 ?? 0) : 0,
      rangeMax: cont ? Domain.q8ToDb(limited ? b.rangeMax : noun?.maxQ8 ?? 0) : 0,
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
    return {
      type: d.type as Domain.CsType,
      noun: d.noun as Domain.CsNoun,
      action: d.action as Domain.CsAction,
      flags: (d.invert ? Domain.CS_FLAG_INVERT : 0)
        | (showReverseOf(d) && d.reverse ? Domain.CS_FLAG_REVERSE : 0)
        | (showWrapOf(d) && d.wrap ? Domain.CS_FLAG_WRAP : 0),
      gpio0: d.gpio0,
      gpio1: twoPins(d) ? d.gpio1 : null,
      value: showValueOf(d) ? (cont ? Domain.dbToQ8(d.value) : Math.round(d.value)) : 0,
      step: showStepOf(d) ? (cont ? Domain.dbToQ8(d.step) : Math.round(d.step)) : 0,
      rangeMin: showRangeOf(d) && d.limitRange ? Domain.dbToQ8(d.rangeMin) : 0,
      rangeMax: showRangeOf(d) && d.limitRange ? Domain.dbToQ8(d.rangeMax) : 0,
    };
  }

  function bindingsEqual(a: Domain.CsBinding, b: Domain.CsBinding): boolean {
    return a.type === b.type && a.noun === b.noun && a.action === b.action
      && a.flags === b.flags && a.gpio0 === b.gpio0
      && (a.gpio1 ?? null) === (b.gpio1 ?? null)
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
    return r.ok ? 'Applied and saved' : r.message;
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
        results[slot] = { ok: true, text: 'Applied and saved' };
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

  function num(e: Event): number | null {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    return Number.isNaN(v) ? null : v;
  }
</script>

<Panel code="CT.02" title="CONTROL SURFACES">
  {#if caps}
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
                  const legal = actionOptionsFor(dr.type, n);
                  if (!legal.includes(dr.action as Domain.CsAction)) dr.action = defaultAction(dr.type, n);
                  defaultOperands(dr);
                });
              }}>
              {#each nounOptionsFor(d.type) as n (n)}
                <option value={String(n)}>{Domain.CS_NOUN_LABEL[n as Domain.CsNoun]}</option>
              {/each}
            </select>
          </div>

          {#if actions.length > 1}
            <div class="row">
              <span class="microlbl">ON PRESS</span>
              <select class="sel" value={String(d.action)} aria-label="Action" disabled={busy || applying}
                onchange={(e) => {
                  const a = Number((e.currentTarget as HTMLSelectElement).value);
                  editDraft(slot, (dr) => { dr.action = a; defaultOperands(dr); });
                }}>
                {#each actions as a (a)}
                  <option value={String(a)}>{Domain.csActionLabel(a, enumOf(d))}</option>
                {/each}
              </select>
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

          {#if showValueOf(d) || showStepOf(d)}
            <div class="row">
              {#if showValueOf(d)}
                <span class="microlbl">{valueLabel(d)}</span>
                {#if contOf(d)}
                  <input class="numfield" type="number" step="0.5"
                    min={cs.nouns[d.noun] ? Domain.q8ToDb(cs.nouns[d.noun].minQ8) : 0}
                    max={cs.nouns[d.noun] ? Domain.q8ToDb(cs.nouns[d.noun].maxQ8) : 0}
                    value={d.value} aria-label="Target level (dB)" disabled={busy || applying}
                    onchange={(e) => { const v = num(e); if (v != null) editDraft(slot, (dr) => { dr.value = v; }); }} />
                  <span class="hint">dB</span>
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
                  <input class="numfield" type="number" step="0.5" min="0"
                    value={d.step} aria-label="Step size (dB)" disabled={busy || applying}
                    onchange={(e) => { const v = num(e); if (v != null) editDraft(slot, (dr) => { dr.step = v; }); }} />
                  <span class="hint">dB</span>
                {/if}
              {/if}
            </div>
          {/if}

          {#if showRangeOf(d)}
            <div class="row">
              <span class="microlbl">LIMIT RANGE</span>
              <ToggleSwitch size="sm" checked={d.limitRange} disabled={busy || applying}
                ariaLabel="Limit the knob's range"
                onChange={(v) => editDraft(slot, (dr) => { dr.limitRange = v; })} />
              {#if d.limitRange}
                <span class="microlbl">MINIMUM</span>
                <input class="numfield" type="number" step="0.5"
                  min={cs.nouns[d.noun] ? Domain.q8ToDb(cs.nouns[d.noun].minQ8) : 0} max="0"
                  value={d.rangeMin} aria-label="Range minimum (dB)" disabled={busy || applying}
                  onchange={(e) => { const v = num(e); if (v != null) editDraft(slot, (dr) => { dr.rangeMin = v; }); }} />
                <span class="microlbl">MAXIMUM</span>
                <input class="numfield" type="number" step="0.5"
                  min={cs.nouns[d.noun] ? Domain.q8ToDb(cs.nouns[d.noun].minQ8) : 0} max="0"
                  value={d.rangeMax} aria-label="Range maximum (dB)" disabled={busy || applying}
                  onchange={(e) => { const v = num(e); if (v != null) editDraft(slot, (dr) => { dr.rangeMax = v; }); }} />
                <span class="hint">dB</span>
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
        <span class="hint">All 8 control slots are in use.</span>
      {/if}
    </div>

  {:else if cs.lastFetchError}
    <div class="hint err pad">{cs.lastFetchError}</div>
  {:else}
    <div class="hint pad">Reading control-surface capabilities…</div>
  {/if}
</Panel>

<style>
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
