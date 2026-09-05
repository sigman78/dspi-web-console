<script lang="ts">
  // One CS binding slot's editor row, extracted from ControlSurfacesPanel
  // (mirrors how CsIrCommands was previously extracted from the same panel).
  // Controlled component: the parent owns `drafts`/`applying` and the apply/
  // revert/remove/rename/type-change actions; this component holds no draft
  // state of its own -- every edit flows up through onEdit/onTypeChange and
  // mutates the parent's record. Read-only derivations (caps, nouns, snap,
  // pin candidates, status) come from the session context, same as
  // CsIrCommands does for its own sub-slots.
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import PinPicker from './PinPicker.svelte';
  import CsIrCommands from './CsIrCommands.svelte';
  import { connection } from '@/state';
  import * as Domain from '@/domain';
  import { csStatusFromByte } from '@/protocol';
  import { getSession } from '@/components/sessionContext';
  import * as CsUnit from './csUnitDisplay';
  import * as CsField from './csFieldHelpers';
  import * as CsDraft from './csDraft';
  import type { Draft } from './csDraft';

  const {
    slot, draft: d, dirty, pill: p, applying, typeOptions,
    onEdit, onTypeChange, onApply, onRevert, onRemove, onRename,
    irResetSignal, onIrDirtyChange,
  }: {
    slot: number;
    draft: Draft;
    dirty: boolean;
    pill: { text: string; cls: string };
    applying: boolean;
    typeOptions: number[];
    onEdit: (fn: (d: Draft) => void) => void;
    onTypeChange: (typeIdx: number) => void;
    onApply: () => void;
    onRevert: () => void;
    onRemove: () => void;
    onRename: (name: string) => void;
    irResetSignal: number;
    onIrDirtyChange: (dirty: boolean) => void;
  } = $props();

  const s = getSession();
  const connected = $derived(connection.connected);
  const snap = $derived(s.mirror.current);
  const cs = $derived(s.controlSurfaces);
  const caps = $derived(s.controlSurfaces.caps);
  const busy = $derived(!connected);

  const STEPPY = CsDraft.STEPPY;

  const actions = $derived(d.type === Domain.CsType.Ir ? [] : actionOptionsFor(d.type, d.noun));

  function contOf(d: Draft): boolean { return CsField.contOf(cs.nouns, d.noun); }
  function enumOf(d: Draft): boolean { return CsField.enumOf(cs.nouns, d.noun); }
  function unitOf(d: Draft): number { return CsField.unitOf(cs.nouns, d.noun); }
  function targetKindOf(d: Draft): number { return CsField.targetKindOf(cs.nouns, d.noun); }

  function showValueOf(d: Draft): boolean { return CsField.showValueOf(d.action); }
  function showStepOf(d: Draft): boolean { return CsField.showStepOf(d.action, STEPPY); }
  function showRangeOf(d: Draft): boolean { return CsDraft.showRangeOf(d, cs.nouns); }
  function showWrapOf(d: Draft): boolean { return CsField.showWrapOf(cs.nouns, d.noun, d.action, STEPPY); }
  function showReverseOf(d: Draft): boolean { return CsDraft.showReverseOf(d); }
  function showAccelOf(d: Draft): boolean { return CsDraft.showAccelOf(d); }
  function showRepeatOf(d: Draft): boolean { return CsDraft.showRepeatOf(d); }
  function showEventOf(d: Draft): boolean { return d.type === Domain.CsType.Button; }
  // MOMENTARY and REPEAT are only legal on the press event; lock the picker
  // there rather than let the user build an invalid combination.
  function eventLocked(d: Draft): boolean { return d.action === Domain.CsAction.Momentary || d.repeat; }
  function showTargetOf(d: Draft): boolean { return CsField.showTargetOf(cs.nouns, d.noun); }
  function showBandOf(d: Draft): boolean { return CsField.showBandOf(cs.nouns, d.noun); }
  function twoPins(d: Draft): boolean { return CsDraft.twoPins(d, caps); }
  function adcOnly(d: Draft): boolean { return CsDraft.adcOnly(d, caps); }
  function showDelaysOf(d: Draft): boolean { return CsDraft.showDelaysOf(d, caps); }
  function showBaseBrightOf(d: Draft): boolean { return CsDraft.showBaseBrightOf(d, caps); }

  function invertLabel(d: Draft): string {
    if (d.type === Domain.CsType.Ir) return 'Idle-low receiver';
    if (d.type === Domain.CsType.Led || d.type === Domain.CsType.LedPwm) return 'Active-low LED';
    if (showReverseOf(d)) return 'Pull-down wiring';
    return 'Active-high wiring';
  }

  function valueLabel(d: Draft): string { return CsField.valueLabel(d.action, contOf(d)); }

  function boolValueOptions(d: Draft): { v: number; label: string }[] { return CsField.boolValueOptions(d.noun); }

  function enumValueOptions(d: Draft): { v: number; label: string }[] {
    return CsField.enumValueOptions(cs.nouns, d.noun, s.presets.names);
  }

  function targetOptionsFor(d: Draft): { v: number; label: string }[] {
    return snap ? CsField.targetOptionsFor(cs.nouns, d.noun, snap.channels) : [];
  }

  function bandOptionsFor(d: Draft): { v: number; label: string }[] {
    return snap ? CsField.bandOptionsFor(d.noun, d.target, snap.channels) : [];
  }

  function nounOptionsFor(typeIdx: number): number[] { return CsDraft.nounOptionsFor(typeIdx, caps, cs.nouns); }
  function actionOptionsFor(typeIdx: number, nounIdx: number): Domain.CsAction[] {
    return CsDraft.actionOptionsFor(typeIdx, nounIdx, caps, cs.nouns);
  }
  function defaultAction(typeIdx: number, nounIdx: number): number {
    return CsDraft.defaultAction(typeIdx, nounIdx, caps, cs.nouns);
  }
  function defaultOperands(d: Draft): void { CsDraft.defaultOperands(d, cs.nouns); }

  // Only LIVE sibling bindings reserve pins (fw control_surfaces_owns_pin);
  // the edited slot's own pins stay selectable.
  function otherCsPins(): ({ gpio0: number; gpio1: number | null } | null)[] {
    return Domain.liveCsPinConfigs(cs.bindings, cs.status).map((pin, i) => (i === slot ? null : pin));
  }

  function cellsFor(selfPin: number, adc: boolean, excludePin?: number): Domain.PinPickerCell[] {
    if (!snap) return [];
    return Domain.pickerCells(snap.platform.type, snap, {
      uart: s.ctrlIfaces.uart, i2c: s.ctrlIfaces.i2c, cs: otherCsPins(),
    }, selfPin).map((c) => {
      if (adc && !Domain.CS_ADC_PINS.includes(c.pin)) c = { ...c, selectable: false, reason: 'not ADC-capable' };
      if (excludePin != null && c.pin === excludePin) c = { ...c, selectable: false, reason: 'assigned to the other encoder pin' };
      return c;
    });
  }

  function inactiveHint(): string {
    const byte = cs.status?.slotStatus[slot] ?? 0;
    const r = csStatusFromByte(byte);
    const why = r.ok ? 'failed to apply the binding' : r.message.toLowerCase();
    return `Not running: ${why}. Reassign the conflicting pin, then apply.`;
  }

  function num(e: Event): number | null {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    return Number.isNaN(v) ? null : v;
  }
</script>

<div class="slot">
  <div class="slothead">
    <span class="stitle" class:staged={dirty}
      title={dirty ? 'Unapplied changes — APPLY to preview them live' : undefined}
      >{Domain.csTypeLabel(d.type).toUpperCase()}</span>
    <input class="nameinput" type="text" maxlength="31" placeholder="Unnamed"
      value={cs.names[slot] ?? ''} aria-label={`Name for control ${slot + 1}`}
      disabled={busy || applying}
      onchange={(e) => onRename((e.currentTarget as HTMLInputElement).value)} />
    <span class="pill {p.cls}">{p.text}</span>
    <span class="spacer"></span>
    <button type="button" class="x" aria-label={`Remove control ${slot + 1}`}
      disabled={applying} onclick={() => onRemove()}>✕</button>
  </div>

  {#if p.cls === 'warn'}
    <div class="hint err srow">{inactiveHint()}</div>
  {/if}

  {#if d.type > Domain.CS_MAX_KNOWN_TYPE}
    <div class="hint pad">
      Configured by a newer host (component type {d.type}) — this console
      can't edit it. Removing the control clears the slot.
    </div>
  {:else}
  <div class="rows">
    <div class="row">
      <span class="microlbl">TYPE</span>
      <select class="sel" value={String(d.type)} aria-label="Component type" disabled={busy || applying}
        onchange={(e) => {
          const t = Number((e.currentTarget as HTMLSelectElement).value);
          onTypeChange(t);
        }}>
        {#each typeOptions as t (t)}
          <option value={String(t)}>{Domain.csTypeLabel(t)}</option>
        {/each}
      </select>
      {#if d.type !== Domain.CsType.Ir}
        <span class="microlbl">CONTROLS</span>
        <select class="sel" value={String(d.noun)} aria-label="Controlled function" disabled={busy || applying}
          onchange={(e) => {
            const n = Number((e.currentTarget as HTMLSelectElement).value);
            onEdit((dr) => {
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
            <option value={String(n)}>{Domain.csNounLabel(n)}</option>
          {/each}
        </select>
      {/if}
    </div>

    {#if actions.length > 1 || showEventOf(d)}
      <div class="row">
        {#if actions.length > 1}
          <span class="microlbl">ON PRESS</span>
          <select class="sel" value={String(d.action)} aria-label="Action" disabled={busy || applying}
            onchange={(e) => {
              const a = Number((e.currentTarget as HTMLSelectElement).value);
              onEdit((dr) => {
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
            onchange={(e) => { const v = Number((e.currentTarget as HTMLSelectElement).value); onEdit((dr) => { dr.event = v; }); }}>
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
        <PinPicker value={d.gpio0} cells={cellsFor(d.gpio0, false, d.gpio1)}
          ariaLabel="Encoder GPIO A" disabled={busy || applying}
          onChange={(pin) => onEdit((dr) => { dr.gpio0 = pin; })} />
        <span class="microlbl">GPIO B</span>
        <PinPicker value={d.gpio1} cells={cellsFor(d.gpio1, false, d.gpio0)}
          ariaLabel="Encoder GPIO B" disabled={busy || applying}
          onChange={(pin) => onEdit((dr) => { dr.gpio1 = pin; })} />
      {:else}
        <span class="microlbl">GPIO</span>
        <PinPicker value={d.gpio0} cells={cellsFor(d.gpio0, adcOnly(d))}
          ariaLabel="Control GPIO" disabled={busy || applying}
          onChange={(pin) => onEdit((dr) => { dr.gpio0 = pin; })} />
      {/if}
    </div>

    {#if d.type !== Domain.CsType.Ir && showTargetOf(d)}
      <div class="row">
        <span class="microlbl">{targetKindOf(d) === Domain.CS_TARGET_INPUT_CH ? 'INPUT' : targetKindOf(d) === Domain.CS_TARGET_OUTPUT_CH ? 'OUTPUT' : 'CHANNEL'}</span>
        <select class="sel" value={String(d.target)} aria-label="Target channel" disabled={busy || applying}
          onchange={(e) => { const v = Number((e.currentTarget as HTMLSelectElement).value); onEdit((dr) => { dr.target = v; dr.index = 0; }); }}>
          {#each targetOptionsFor(d) as o (o.v)}
            <option value={String(o.v)}>{o.label}</option>
          {/each}
        </select>
        {#if showBandOf(d)}
          <span class="microlbl">BAND</span>
          <select class="sel" value={String(d.index)} aria-label="Filter band" disabled={busy || applying}
            onchange={(e) => { const v = Number((e.currentTarget as HTMLSelectElement).value); onEdit((dr) => { dr.index = v; }); }}>
            {#each bandOptionsFor(d) as o (o.v)}
              <option value={String(o.v)}>{o.label}</option>
            {/each}
          </select>
        {/if}
      </div>
    {/if}

    {#if d.type !== Domain.CsType.Ir && (showValueOf(d) || showStepOf(d))}
      <div class="row">
        {#if showValueOf(d)}
          <span class="microlbl">{valueLabel(d)}</span>
          {#if contOf(d)}
            <input class="numfield" type="number" step="0.5"
              min={cs.nouns[d.noun] ? CsUnit.valueToDisplay(unitOf(d), cs.nouns[d.noun].minQ8) : 0}
              max={cs.nouns[d.noun] ? CsUnit.valueToDisplay(unitOf(d), cs.nouns[d.noun].maxQ8) : 0}
              value={d.value} aria-label={`${valueLabel(d)} (${CsUnit.unitSuffix(unitOf(d))})`} disabled={busy || applying}
              onchange={(e) => { const v = num(e); if (v != null) onEdit((dr) => { dr.value = v; }); }} />
            <span class="hint">{CsUnit.unitSuffix(unitOf(d))}</span>
          {:else}
            <select class="sel" value={String(d.value)} aria-label={valueLabel(d)} disabled={busy || applying}
              onchange={(e) => { const v = Number((e.currentTarget as HTMLSelectElement).value); onEdit((dr) => { dr.value = v; }); }}>
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
              onchange={(e) => { const v = num(e); if (v != null) onEdit((dr) => { dr.step = v; }); }} />
          {:else}
            <input class="numfield" type="number" step={CsUnit.isLogStep(unitOf(d)) ? '0.01' : '0.5'} min="0"
              value={d.step} aria-label={`Step size (${CsUnit.stepUnitSuffix(unitOf(d))})`} disabled={busy || applying}
              onchange={(e) => { const v = num(e); if (v != null) onEdit((dr) => { dr.step = v; }); }} />
            <span class="hint">{CsUnit.stepUnitSuffix(unitOf(d))}</span>
          {/if}
        {/if}
      </div>
    {/if}

    {#if d.type !== Domain.CsType.Ir && showRangeOf(d)}
      <div class="row">
        <span class="microlbl">LIMIT RANGE</span>
        <ToggleSwitch size="sm" checked={d.limitRange} disabled={busy || applying}
          ariaLabel="Limit the range"
          onChange={(v) => onEdit((dr) => { dr.limitRange = v; })} />
        {#if d.limitRange}
          <span class="microlbl">MINIMUM</span>
          <input class="numfield" type="number" step="0.5"
            min={cs.nouns[d.noun] ? CsUnit.valueToDisplay(unitOf(d), cs.nouns[d.noun].minQ8) : 0}
            max={cs.nouns[d.noun] ? CsUnit.valueToDisplay(unitOf(d), cs.nouns[d.noun].maxQ8) : 0}
            value={d.rangeMin} aria-label={`Range minimum (${CsUnit.unitSuffix(unitOf(d))})`} disabled={busy || applying}
            onchange={(e) => { const v = num(e); if (v != null) onEdit((dr) => { dr.rangeMin = v; }); }} />
          <span class="microlbl">MAXIMUM</span>
          <input class="numfield" type="number" step="0.5"
            min={cs.nouns[d.noun] ? CsUnit.valueToDisplay(unitOf(d), cs.nouns[d.noun].minQ8) : 0}
            max={cs.nouns[d.noun] ? CsUnit.valueToDisplay(unitOf(d), cs.nouns[d.noun].maxQ8) : 0}
            value={d.rangeMax} aria-label={`Range maximum (${CsUnit.unitSuffix(unitOf(d))})`} disabled={busy || applying}
            onchange={(e) => { const v = num(e); if (v != null) onEdit((dr) => { dr.rangeMax = v; }); }} />
          <span class="hint">{CsUnit.unitSuffix(unitOf(d))}</span>
        {/if}
      </div>
    {/if}

    {#if showDelaysOf(d) || showBaseBrightOf(d)}
      <div class="row">
        {#if showDelaysOf(d)}
          <span class="microlbl">ON DELAY</span>
          <input class="numfield" type="number" step="0.1" min="0" max="6553.5"
            value={d.onDelay} aria-label="On delay (s)"
            title="Condition must hold this long before the LED lights" disabled={busy || applying}
            onchange={(e) => { const v = num(e); if (v != null) onEdit((dr) => { dr.onDelay = v; }); }} />
          <span class="hint">s</span>
          <span class="microlbl">OFF DELAY</span>
          <input class="numfield" type="number" step="0.1" min="0" max="6553.5"
            value={d.offDelay} aria-label="Off delay (s)"
            title="Condition must hold this long before the LED goes out" disabled={busy || applying}
            onchange={(e) => { const v = num(e); if (v != null) onEdit((dr) => { dr.offDelay = v; }); }} />
          <span class="hint">s</span>
        {/if}
        {#if showBaseBrightOf(d)}
          <span class="microlbl">LIMIT BRIGHTNESS</span>
          <ToggleSwitch size="sm" checked={d.limitBright} disabled={busy || applying}
            ariaLabel="Limit brightness"
            onChange={(v) => onEdit((dr) => { dr.limitBright = v; })} />
          {#if d.limitBright}
            <span class="microlbl">CEILING</span>
            <input class="numfield" type="number" step="1" min="1" max="100"
              value={d.baseBright} aria-label="Brightness ceiling (%)" disabled={busy || applying}
              onchange={(e) => { const v = num(e); if (v != null) onEdit((dr) => { dr.baseBright = v; }); }} />
            <span class="hint">%</span>
          {/if}
        {/if}
      </div>
    {/if}

    <div class="row">
      <span class="microlbl">{invertLabel(d).toUpperCase()}</span>
      <ToggleSwitch size="sm" checked={d.invert} disabled={busy || applying}
        ariaLabel={invertLabel(d)}
        onChange={(v) => onEdit((dr) => { dr.invert = v; })} />
      {#if showReverseOf(d)}
        <span class="microlbl">REVERSE DIRECTION</span>
        <ToggleSwitch size="sm" checked={d.reverse} disabled={busy || applying}
          ariaLabel="Reverse direction"
          onChange={(v) => onEdit((dr) => { dr.reverse = v; })} />
      {/if}
      {#if showWrapOf(d)}
        <span class="microlbl">WRAP AROUND</span>
        <ToggleSwitch size="sm" checked={d.wrap} disabled={busy || applying}
          ariaLabel="Wrap around"
          onChange={(v) => onEdit((dr) => { dr.wrap = v; })} />
      {/if}
      {#if showAccelOf(d)}
        <span class="microlbl">ACCELERATE FAST ROTATION</span>
        <ToggleSwitch size="sm" checked={d.accel} disabled={busy || applying}
          ariaLabel="Accelerate on fast rotation"
          onChange={(v) => onEdit((dr) => { dr.accel = v; })} />
      {/if}
      {#if showRepeatOf(d)}
        <span class="microlbl">AUTO-REPEAT WHILE HELD</span>
        <ToggleSwitch size="sm" checked={d.repeat} disabled={busy || applying}
          ariaLabel="Auto-repeat while held"
          onChange={(v) => onEdit((dr) => { dr.repeat = v; if (v) dr.event = Domain.CsEvent.Press; })} />
      {/if}
    </div>

    <div class="row">
      <button type="button" class="chip accent" onclick={() => onApply()}
        disabled={busy || applying || !dirty}>APPLY</button>
      <button type="button" class="chip hi" onclick={() => onRevert()}
        disabled={applying || !cs.bindings[slot] || !dirty}>REVERT</button>
    </div>
  </div>
  {/if}

  {#if cs.bindings[slot]?.type === Domain.CsType.Ir}
    <CsIrCommands resetSignal={irResetSignal} onDirtyChange={onIrDirtyChange} />
  {/if}
</div>

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
  .hint.err { color: var(--err); }
  .pad { padding: 10px 14px; }
</style>
