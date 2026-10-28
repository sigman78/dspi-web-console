<script lang="ts">
  // One CS binding slot's editor row, extracted from ControlSurfacesPanel
  // (mirrors how CsIrCommands was previously extracted from the same panel).
  // Controlled component: the parent owns `drafts`/`applying` and the apply/
  // revert/remove/rename actions; this component holds no draft
  // state of its own -- every edit flows up through onEdit and
  // mutates the parent's record. Read-only derivations (caps, nouns, snap,
  // pin candidates, status) come from the session context, same as
  // CsIrCommands does for its own sub-slots.
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import { formatI2cAddr, parseI2cAddr } from '@/components/chrome/format';
  import PinPicker from '@/components/chrome/PinPicker.svelte';
  import CsIrCommands from './CsIrCommands.svelte';
  import CsSlotCard from './CsSlotCard.svelte';
  import CsNamePopover from './CsNamePopover.svelte';
  import { defaultUnitFor } from '@/components/chrome/valueFieldFormat';
  import NumField from '@/components/chrome/NumField.svelte';
  import CsTargetRow from './CsTargetRow.svelte';
  import CsValueStepRow from './CsValueStepRow.svelte';
  import * as Domain from '@/domain';
  import * as Staged from '@/runtime/stagedActions';
  import { csStatusFromByte, CsStatusCode } from '@/protocol';
  import { getSession } from '@/components/sessionContext';
  import * as CsUnit from '@/domain/cs/unitDisplay';
  import * as CsField from '@/domain/cs/fieldHelpers';
  import { unitField } from './csFieldFormat';
  import * as CsDraft from '@/domain/cs/draft';
  import type { Draft } from '@/domain/cs/draft';

  const {
    slot, draft: d, dirty, live, pill: p, applying,
    onEdit, onApply, onRevert, onRemove, onRenameRequest,
    renaming, onRenameCommit, onRenameCancel,
    open, onToggle, detailTarget = null, irDetailTarget = null,
  }: {
    slot: number;
    draft: Draft;
    dirty: boolean;
    live: boolean;
    pill: { text: string; cls: string };
    applying: boolean;
    onEdit: (fn: (d: Draft) => void) => void;
    onApply: () => void;
    onRevert: () => void;
    onRemove: () => void;
    onRenameRequest: () => void;
    renaming: boolean;
    onRenameCommit: (name: string) => void;
    onRenameCancel: () => void;
    open: boolean;
    onToggle: () => void;
    detailTarget?: HTMLElement | null;
    irDetailTarget?: HTMLElement | null;
  } = $props();

  const s = getSession();
  const snap = $derived(s.mirror.current);
  // Pin context includes staged claims, so a binding can't take a pin an
  // unapplied change is about to occupy.
  const pinSnap = $derived(snap ? s.staging.overlaySnapshot(snap) : null);
  const cs = $derived(s.controlSurfaces);
  const caps = $derived(s.controlSurfaces.caps);

  const STEPPY = CsDraft.STEPPY;

  const actions = $derived(d.type === Domain.CsType.Ir ? [] : actionOptionsFor(d.type, d.noun));

  function enumOf(d: Draft): boolean { return CsField.enumOf(cs.nouns, d.noun); }
  function unitOf(d: Draft): number { return CsField.unitOf(cs.nouns, d.noun); }

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

  function showGroupOf(d: Draft): boolean { return CsDraft.showGroupOf(d, caps, cs.nouns); }
  function showLinkAbsOf(d: Draft): boolean { return CsDraft.showLinkAbsOf(d, cs.nouns); }
  function showGroupAllOf(d: Draft): boolean { return CsDraft.showGroupAllOf(d); }

  function nounOptionsFor(typeIdx: number, current?: number): number[] { return CsDraft.nounOptionsFor(typeIdx, caps, cs.nouns, current); }
  function actionOptionsFor(typeIdx: number, nounIdx: number): Domain.CsAction[] {
    return CsDraft.actionOptionsFor(typeIdx, nounIdx, caps, cs.nouns);
  }
  function defaultAction(typeIdx: number, nounIdx: number): number {
    return CsDraft.defaultAction(typeIdx, nounIdx, caps, cs.nouns);
  }
  function defaultOperands(d: Draft): void { CsDraft.defaultOperands(d, cs.nouns); }

  // Only LIVE sibling bindings reserve pins (fw control_surfaces_owns_pin);
  // the edited slot's own pins stay selectable.
  function otherCsPins() {
    return Domain.liveCsPinConfigs(cs.bindings, cs.status).map((pin, i) => (i === slot ? null : pin));
  }

  function pinCtrl() {
    return { uart: Staged.stagedUart(s), i2c: Staged.stagedI2c(s), cs: otherCsPins() };
  }

  function cellsFor(selfPin: number, adc: boolean, excludePin?: number): Domain.PinPickerCell[] {
    if (!pinSnap) return [];
    return Domain.pickerCells(pinSnap.platform.type, pinSnap, pinCtrl(), selfPin).map((c) => {
      if (adc && !Domain.CS_ADC_PINS.includes(c.pin)) c = { ...c, selectable: false, reason: 'not ADC-capable' };
      if (excludePin != null && c.pin === excludePin) c = { ...c, selectable: false, reason: 'assigned to the other encoder pin' };
      return c;
    });
  }

  function modelOptions(): number[] {
    const count = cs.displayLimits?.modelCount ?? Domain.CS_DISPLAY_MODEL_COUNT;
    return Array.from({ length: Math.max(0, count - 1) }, (_, i) => i + 1);
  }

  // ADDRESS is free text so an in-progress, not-yet-valid entry (mid-typing,
  // or a value out of range) stays visible with an error instead of being
  // silently discarded or reverted -- only a valid parse writes d.value.
  // The text resyncs from the draft's value whenever that changes for a
  // reason other than this field's own edit (type switch, revert, a valid
  // commit normalizing the format).
  function formatAddr(v: number): string {
    return v === 0 ? '' : formatI2cAddr(v);
  }
  let addrText = $derived(formatAddr(d.value));

  // Empty = 0 = model default.
  function addrTextValid(text: string): boolean {
    return text.trim() === '' || parseI2cAddr(text) !== null;
  }
  function addrTextValue(text: string): number {
    return parseI2cAddr(text) ?? 0;
  }

  function addressPlaceholder(d: Draft): string {
    const info = Domain.csDisplayModelInfo(d.index);
    return info ? `default ${formatI2cAddr(info.defaultAddr)}` : 'default';
  }

  function displayHint(d: Draft): string {
    const model = Domain.csDisplayModelInfo(d.index);
    const parts: string[] = [];
    if (model) parts.push(`${model.khz} kHz`);
    if (model?.fiveVolt) parts.push('5 V module — use a level shifter or a 3.3 V-verified board');
    parts.push('external 2.2–4.7 kΩ pull-ups assumed');
    return parts.join(' · ');
  }

  // Full client-side pre-validation of the built binding, so a pin pair the
  // pickers' own per-cell rules can't catch on their own (e.g. two otherwise-
  // legal pins that still collide with a live sibling slot) still blocks
  // APPLY rather than being sent to the device to be rejected there.
  function displayBindingValid(d: Draft): boolean {
    if (!caps) return false;
    return Domain.validateCsBinding(
      CsDraft.buildBinding(d, cs.nouns, caps), caps, cs.nouns, cs.groups, CsField.liveI2cInstance(Staged.stagedI2c(s)),
    ) === 0;
  }

  function canApplyDisplay(d: Draft): boolean {
    return addrTextValid(addrText) && displayBindingValid(d);
  }

  function displaySdaCells(d: Draft): Domain.PinPickerCell[] {
    if (!pinSnap) return [];
    const ctrl = pinCtrl();
    const cands = Domain.validDisplaySdaPins(pinSnap.platform.type, pinSnap, ctrl, CsField.liveI2cInstance(Staged.stagedI2c(s)));
    return Domain.pickerCellsFrom(pinSnap.platform.type, pinSnap, ctrl, cands, d.gpio0,
      (pin) => (pin % 2 !== 0 ? 'Not an SDA pin (even GPIO)' : 'That I2C bus is used by the control interface'));
  }
  function displaySclCells(d: Draft): Domain.PinPickerCell[] {
    if (!pinSnap) return [];
    const ctrl = pinCtrl();
    const cands = Domain.validDisplaySclPins(pinSnap.platform.type, pinSnap, ctrl, d.gpio0);
    return Domain.pickerCellsFrom(pinSnap.platform.type, pinSnap, ctrl, cands, d.gpio1,
      () => 'SCL must be on the same I2C bus as SDA');
  }

  // Re-picking SDA can strand the current SCL pin (different instance, or no
  // longer free) -- re-snap it to sda+1 when that's legal, else the first
  // remaining candidate, same preference order as the panel's defaultDraft.
  function onDisplaySdaChange(pin: number): void {
    onEdit((dr) => {
      dr.gpio0 = pin;
      if (!pinSnap) return;
      const sclCands = Domain.validDisplaySclPins(pinSnap.platform.type, pinSnap, pinCtrl(), pin);
      if (!sclCands.includes(dr.gpio1)) {
        dr.gpio1 = sclCands.includes(pin + 1) ? pin + 1 : (sclCands[0] ?? 0);
      }
    });
  }

  function inactiveHint(): string {
    const byte = cs.status?.slotStatus[slot] ?? 0;
    const r = csStatusFromByte(byte);
    const why = r.ok ? 'failed to apply the binding' : r.message.toLowerCase();
    const advice = byte === CsStatusCode.InvalidGroup
      ? 'Fix or re-create the group, then apply.'
      : 'Reassign the conflicting pin, then apply.';
    return `Not running: ${why}. ${advice}`;
  }
</script>

<CsSlotCard title={Domain.csTypeLabel(d.type).toUpperCase()} name={d.name ?? cs.names[slot] ?? ''}
  nameLabel={`Rename control ${slot + 1}`} removeLabel={`Remove control ${slot + 1}`}
  pill={p} {dirty} {live} {open} disabled={applying}
  {onToggle} {onRenameRequest} {onRemove} {detailTarget}>
  {#snippet rename()}
    {#if renaming}
      <CsNamePopover title="RENAME" value={d.name ?? cs.names[slot] ?? ''}
        onCommit={onRenameCommit} onCancel={onRenameCancel} />
    {/if}
  {/snippet}
  {#if p.cls === 'warn'}
    <div class="hint err cs-srow">{inactiveHint()}</div>
  {/if}

  {#if d.type > Domain.CS_MAX_KNOWN_TYPE}
    <div class="hint cs-pad">
      Configured by a newer host (component type {d.type}) — this console
      can't edit it. Removing the control clears the slot.
    </div>
  {:else}
  <div class="cs-rows">
    <div class="cs-row">
      <span class="microlbl">TYPE</span>
      <span class="typeval">{Domain.csTypeLabel(d.type)}</span>
      {#if !CsDraft.isDisplay(d) && d.type !== Domain.CsType.Ir}
        <span class="microlbl">CONTROLS</span>
        <select class="sel" value={String(d.noun)} aria-label="Controlled function" disabled={applying}
          onchange={(e) => {
            const n = Number((e.currentTarget as HTMLSelectElement).value);
            onEdit((dr) => {
              dr.noun = n;
              dr.target = 0;
              dr.index = 0;
              dr.grouped = false;
              dr.linkAbs = false;
              dr.groupAll = false;
              const legal = actionOptionsFor(dr.type, n);
              if (!legal.includes(dr.action as Domain.CsAction)) dr.action = defaultAction(dr.type, n);
              defaultOperands(dr);
              if (dr.action === Domain.CsAction.Momentary) dr.event = Domain.CsEvent.Press;
            });
          }}>
          {#each nounOptionsFor(d.type, d.noun) as n (n)}
            <option value={String(n)}>{Domain.csNounLabel(n)}</option>
          {/each}
        </select>
      {/if}
    </div>

    {#if CsDraft.isDisplay(d)}
      <div class="cs-row">
        <span class="microlbl">MODEL</span>
        <select class="sel" value={String(d.index)} aria-label="Display model" disabled={applying}
          onchange={(e) => {
            const m = Number((e.currentTarget as HTMLSelectElement).value);
            onEdit((dr) => { dr.index = m; });
          }}>
          {#each modelOptions() as m (m)}
            <option value={String(m)}>{Domain.csDisplayModelInfo(m)?.label ?? `Model ${m}`}</option>
          {/each}
        </select>
        <span class="microlbl">ADDRESS</span>
        <input class="numfield addrfield" type="text" value={addrText} placeholder={addressPlaceholder(d)}
          aria-label="I2C address (hex)" disabled={applying}
          onchange={(e) => {
            addrText = (e.currentTarget as HTMLInputElement).value;
            if (addrTextValid(addrText)) onEdit((dr) => { dr.value = addrTextValue(addrText); });
          }} />
        {#if !addrTextValid(addrText)}
          <span class="hint err">Address must be 0x08–0x77</span>
        {/if}
      </div>
    {/if}

    {#if !CsDraft.isDisplay(d) && (actions.length > 1 || showEventOf(d))}
      <div class="cs-row">
        {#if actions.length > 1}
          <span class="microlbl">ON PRESS</span>
          <select class="sel" value={String(d.action)} aria-label="Action" disabled={applying}
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
            disabled={applying || eventLocked(d)}
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

    <div class="cs-row">
      {#if CsDraft.isDisplay(d)}
        <span class="microlbl">SDA</span>
        <PinPicker value={d.gpio0} cells={displaySdaCells(d)}
          ariaLabel="Display SDA pin" disabled={applying}
          onChange={onDisplaySdaChange} />
        <span class="microlbl">SCL</span>
        <PinPicker value={d.gpio1} cells={displaySclCells(d)}
          ariaLabel="Display SCL pin" disabled={applying}
          onChange={(pin) => onEdit((dr) => { dr.gpio1 = pin; })} />
      {:else if twoPins(d)}
        <span class="microlbl">GPIO A</span>
        <PinPicker value={d.gpio0} cells={cellsFor(d.gpio0, false, d.gpio1)}
          ariaLabel="Encoder GPIO A" disabled={applying}
          onChange={(pin) => onEdit((dr) => { dr.gpio0 = pin; })} />
        <span class="microlbl">GPIO B</span>
        <PinPicker value={d.gpio1} cells={cellsFor(d.gpio1, false, d.gpio0)}
          ariaLabel="Encoder GPIO B" disabled={applying}
          onChange={(pin) => onEdit((dr) => { dr.gpio1 = pin; })} />
      {:else}
        <span class="microlbl">GPIO</span>
        <PinPicker value={d.gpio0} cells={cellsFor(d.gpio0, adcOnly(d))}
          ariaLabel="Control GPIO" disabled={applying}
          onChange={(pin) => onEdit((dr) => { dr.gpio0 = pin; })} />
      {/if}
    </div>

    {#if CsDraft.isDisplay(d)}
      <div class="cs-row">
        <span class="hint">{displayHint(d)}</span>
      </div>
    {/if}

    {#if !CsDraft.isDisplay(d) && d.type !== Domain.CsType.Ir && showTargetOf(d)}
      <div class="cs-row">
        <CsTargetRow nouns={cs.nouns} noun={d.noun} target={d.target} index={d.index} grouped={d.grouped}
          channels={snap?.channels ?? []} groups={cs.groups} groupsEnabled={showGroupOf(d)}
          disabled={applying}
          onTarget={(pick) => onEdit((dr) => {
            dr.grouped = pick.grouped;
            dr.target = pick.target;
            if (!pick.grouped) { dr.linkAbs = false; dr.groupAll = false; }
            dr.index = 0;
          })}
          onBand={(v) => onEdit((dr) => { dr.index = v; })} />
      </div>
    {/if}

    {#if !CsDraft.isDisplay(d) && d.type !== Domain.CsType.Ir && d.noun !== Domain.CsNoun.PageValue && (showValueOf(d) || showStepOf(d))}
      <div class="cs-row">
        <CsValueStepRow nouns={cs.nouns} noun={d.noun} action={d.action} steppy={STEPPY} presetNames={s.presets.names} macros={cs.macros} displayPages={cs.displayPages}
          value={d.value} step={d.step} disabled={applying}
          onValue={(v) => onEdit((dr) => { dr.value = v; })}
          onStep={(v) => onEdit((dr) => { dr.step = v; })} />
      </div>
    {/if}

    {#if !CsDraft.isDisplay(d) && d.type !== Domain.CsType.Ir && d.noun !== Domain.CsNoun.PageValue && showRangeOf(d)}
      <div class="cs-row">
        <span class="microlbl">LIMIT RANGE</span>
        <ToggleSwitch checked={d.limitRange} disabled={applying}
          ariaLabel="Limit the range"
          onChange={(v) => onEdit((dr) => { dr.limitRange = v; })} />
        {#if d.limitRange}
          {@const bounds = CsField.valueBounds(cs.nouns, d.noun)}
          {@const uf = unitField(unitOf(d))}
          <span class="microlbl">MINIMUM</span>
          <NumField value={d.rangeMin} min={bounds.min} max={bounds.max} step={uf.step}
            kind={uf.kind} precision={uf.precision} disabled={applying}
            ariaLabel={`Range minimum (${CsUnit.unitSuffix(unitOf(d))})`}
            onChange={(v) => onEdit((dr) => { dr.rangeMin = v; })} />
          <span class="microlbl">MAXIMUM</span>
          <NumField value={d.rangeMax} min={bounds.min} max={bounds.max} step={uf.step}
            kind={uf.kind} precision={uf.precision} disabled={applying}
            ariaLabel={`Range maximum (${CsUnit.unitSuffix(unitOf(d))})`}
            hint={defaultUnitFor(uf.kind) === '' ? CsUnit.unitSuffix(unitOf(d)) : undefined}
            onChange={(v) => onEdit((dr) => { dr.rangeMax = v; })} />
        {/if}
      </div>
    {/if}

    {#if showDelaysOf(d) || showBaseBrightOf(d)}
      <div class="cs-row">
        {#if showDelaysOf(d)}
          <span class="microlbl">ON DELAY</span>
          <NumField value={d.onDelay} min={0} max={6553.5} step={0.1} kind="s" precision={1}
            ariaLabel="On delay (s)" title="Condition must hold this long before the LED lights" disabled={applying}
            onChange={(v) => onEdit((dr) => { dr.onDelay = v; })} />
          <span class="microlbl">OFF DELAY</span>
          <NumField value={d.offDelay} min={0} max={6553.5} step={0.1} kind="s" precision={1}
            ariaLabel="Off delay (s)" title="Condition must hold this long before the LED goes out" disabled={applying}
            onChange={(v) => onEdit((dr) => { dr.offDelay = v; })} />
        {/if}
        {#if showBaseBrightOf(d)}
          <span class="microlbl">LIMIT BRIGHTNESS</span>
          <ToggleSwitch checked={d.limitBright} disabled={applying}
            ariaLabel="Limit brightness"
            onChange={(v) => onEdit((dr) => { dr.limitBright = v; })} />
          {#if d.limitBright}
            <span class="microlbl">CEILING</span>
            <NumField value={d.baseBright} min={1} max={100} step={1} kind="pct" precision={0}
              ariaLabel="Brightness ceiling (%)" disabled={applying}
              onChange={(v) => onEdit((dr) => { dr.baseBright = v; })} />
          {/if}
        {/if}
      </div>
    {/if}

    {#if !CsDraft.isDisplay(d)}
      <div class="cs-row">
        <span class="microlbl">{invertLabel(d).toUpperCase()}</span>
        <ToggleSwitch checked={d.invert} disabled={applying}
          ariaLabel={invertLabel(d)}
          onChange={(v) => onEdit((dr) => { dr.invert = v; })} />
        {#if showReverseOf(d)}
          <span class="microlbl">REVERSE DIRECTION</span>
          <ToggleSwitch checked={d.reverse} disabled={applying}
            ariaLabel="Reverse direction"
            onChange={(v) => onEdit((dr) => { dr.reverse = v; })} />
        {/if}
        {#if showWrapOf(d)}
          <span class="microlbl">WRAP AROUND</span>
          <ToggleSwitch checked={d.wrap} disabled={applying}
            ariaLabel="Wrap around"
            onChange={(v) => onEdit((dr) => { dr.wrap = v; })} />
        {/if}
        {#if showAccelOf(d)}
          <span class="microlbl">ACCELERATE FAST ROTATION</span>
          <ToggleSwitch checked={d.accel} disabled={applying}
            ariaLabel="Accelerate on fast rotation"
            onChange={(v) => onEdit((dr) => { dr.accel = v; })} />
        {/if}
        {#if showRepeatOf(d)}
          <span class="microlbl">AUTO-REPEAT WHILE HELD</span>
          <ToggleSwitch checked={d.repeat} disabled={applying}
            ariaLabel="Auto-repeat while held"
            onChange={(v) => onEdit((dr) => { dr.repeat = v; if (v) dr.event = Domain.CsEvent.Press; })} />
        {/if}
        {#if d.grouped && showLinkAbsOf(d)}
          <span class="microlbl" title="Off: the pot moves the group together while each member keeps its offset">SAME LEVEL FOR ALL</span>
          <ToggleSwitch checked={d.linkAbs} disabled={applying}
            ariaLabel="Drive every member to the same level"
            onChange={(v) => onEdit((dr) => { dr.linkAbs = v; })} />
        {/if}
        {#if d.grouped && showGroupAllOf(d)}
          <span class="microlbl" title="Off: lights when any member matches">ALL MEMBERS</span>
          <ToggleSwitch checked={d.groupAll} disabled={applying}
            ariaLabel="Require every member to match"
            onChange={(v) => onEdit((dr) => { dr.groupAll = v; })} />
        {/if}
      </div>
    {/if}

    <div class="cs-row">
      <button type="button" class="chip accent" onclick={() => onApply()}
        disabled={applying || !dirty || (CsDraft.isDisplay(d) && !canApplyDisplay(d))}>APPLY</button>
      <button type="button" class="chip hi" onclick={() => onRevert()}
        disabled={applying || !cs.bindings[slot] || !dirty}>REVERT</button>
    </div>
  </div>
  {/if}

  {#if cs.bindings[slot]?.type === Domain.CsType.Ir}
    <CsIrCommands {irDetailTarget} />
  {/if}
</CsSlotCard>

<style>
  .typeval { font-family: var(--font-mono); font-size: 11px; color: var(--text); }
  .numfield {
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 3px 6px;
    width: 64px;
  }
  .addrfield { width: 96px; }
</style>
