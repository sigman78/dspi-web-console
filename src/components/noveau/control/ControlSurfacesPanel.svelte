<script lang="ts">
  import { untrack } from 'svelte';
  import Panel from '@/components/chrome/Panel.svelte';
  import CsBindingRow from './CsBindingRow.svelte';
  import CsNamePopover from './CsNamePopover.svelte';
  import { applyCsBinding, clearCsBinding, applyCsName } from '@/runtime';
  import * as Domain from '@/domain';
  import { getSession } from '@/components/sessionContext';
  import * as CsDraft from '@/domain/cs/draft';
  import type { Draft } from '@/domain/cs/draft';
  import * as CsField from '@/domain/cs/fieldHelpers';
  import * as SlotOps from './csSlotOps';

  const { detailTarget = null, irDetailTarget = null }: {
    detailTarget?: HTMLElement | null;
    irDetailTarget?: HTMLElement | null;
  } = $props();

  const s = getSession();
  const snap = $derived(s.mirror.current);
  const cs = $derived(s.controlSurfaces);
  const caps = $derived(s.controlSurfaces.caps);

  const drafts = s.drafts.of<Draft>('cs');
  let applying = $state(false);
  function setApplying(busy: boolean): void { applying = busy; }

  const maxSlots = $derived(caps?.maxBindings ?? Domain.CS_MAX_BINDINGS);
  const visibleSlots = $derived(
    Array.from({ length: maxSlots }, (_, i) => i)
      .filter((i) => cs.bindings[i] != null || drafts.draftOf(i) != null),
  );
  const allUsed = $derived(visibleSlots.length >= maxSlots);

  // openSlot === -1 means "collapse all"; null means "no preference yet"
  // (first render). expanded falls back to the first visible slot whenever
  // openSlot points nowhere valid, so exactly one slot is open once any exist.
  let openSlot = $state<number | null>(null);
  const expanded = $derived(
    openSlot === -1 ? null : (openSlot != null && visibleSlots.includes(openSlot) ? openSlot : (visibleSlots[0] ?? null)),
  );
  function toggleSlot(slot: number): void {
    openSlot = expanded === slot ? -1 : slot;
  }

  // pinCount 0 filters NONE; the type ceiling filters components a newer caps
  // format publishes (v10's I2C display) whose bindings this console can't author.
  const typeOptions = $derived(
    caps ? caps.types.map((_, i) => i).filter((i) => caps.types[i].pinCount > 0 && i <= Domain.CS_MAX_KNOWN_TYPE) : [],
  );

  // Firmware allows only one live IR component (CS_STATUS_IR_IN_USE on a
  // second); hiding the option once a slot already holds one (live or
  // drafted) is a cheap client-side nicety, not enforcement -- the device
  // remains the authority and its rejection still surfaces via status.
  const irReceiverSlot = $derived(
    (() => {
      for (let i = 0; i < maxSlots; i++) {
        if (cs.bindings[i]?.type === Domain.CsType.Ir || drafts.draftOf(i)?.type === Domain.CsType.Ir) return i;
      }
      return null;
    })(),
  );
  // Firmware allows only one live display slot too (CS_STATUS_DISPLAY_IN_USE
  // on a second); same client-side nicety as irReceiverSlot above.
  const displaySlot = $derived(
    (() => {
      for (let i = 0; i < maxSlots; i++) {
        if (cs.bindings[i]?.type === Domain.CsType.Display || drafts.draftOf(i)?.type === Domain.CsType.Display) return i;
      }
      return null;
    })(),
  );
  function typeOptionsFor(slot: number): number[] {
    return typeOptions.filter((t) =>
      (t !== Domain.CsType.Ir || irReceiverSlot === null || irReceiverSlot === slot)
      && (t !== Domain.CsType.Display || displaySlot === null || displaySlot === slot));
  }

  function nounOptionsFor(typeIdx: number): number[] { return CsDraft.nounOptionsFor(typeIdx, caps, cs.nouns); }
  function defaultAction(typeIdx: number, nounIdx: number): number {
    return CsDraft.defaultAction(typeIdx, nounIdx, caps, cs.nouns);
  }
  function defaultOperands(d: Draft): void { CsDraft.defaultOperands(d, cs.nouns); }
  function twoPins(d: Draft): boolean { return CsDraft.twoPins(d, caps); }
  function adcOnly(d: Draft): boolean { return CsDraft.adcOnly(d, caps); }

  // Only LIVE sibling bindings reserve pins (fw control_surfaces_owns_pin);
  // the edited slot's own pins stay selectable.
  function otherCsPins(slot: number) {
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

  // IR's container binding always carries noun=action=0 and the rest zeroed
  // (validateCsBinding rejects anything else); only gpio0 and invert are real.
  function defaultDraft(typeIdx: number, slot: number): Draft {
    if (typeIdx === Domain.CsType.Ir) {
      const d: Draft = {
        type: typeIdx, noun: 0, action: 0, event: Domain.CsEvent.Press,
        gpio0: 0, gpio1: 0, target: 0, index: 0,
        invert: false, reverse: false, wrap: false, accel: false, repeat: false,
        value: 0, step: 0, limitRange: false, rangeMin: 0, rangeMax: 0,
        onDelay: 0, offDelay: 0, limitBright: false, baseBright: 100,
        grouped: false, linkAbs: false, groupAll: false,
      };
      d.gpio0 = firstFree(candidatesFor(slot, -1, false));
      return d;
    }
    if (typeIdx === Domain.CsType.Display) {
      const d: Draft = {
        type: typeIdx, noun: 0, action: 0, event: Domain.CsEvent.Press,
        gpio0: 0, gpio1: 0, target: 0, index: Domain.CsDisplayModel.Ssd1306_128x64,
        invert: false, reverse: false, wrap: false, accel: false, repeat: false,
        value: 0, step: 0, limitRange: false, rangeMin: 0, rangeMax: 0,
        onDelay: 0, offDelay: 0, limitBright: false, baseBright: 100,
        grouped: false, linkAbs: false, groupAll: false,
      };
      if (snap) {
        const ctrl = { uart: s.ctrlIfaces.uart, i2c: s.ctrlIfaces.i2c, cs: otherCsPins(slot) };
        const sdaCands = Domain.validDisplaySdaPins(snap.platform.type, snap, ctrl, CsField.liveI2cInstance(s.ctrlIfaces.i2c));
        // Prefer an SDA pin whose sda+1 is itself a legal SCL pin (the
        // common wiring), falling back to any SDA with its first free SCL.
        const withAdjacentScl = sdaCands.find((sda) =>
          Domain.validDisplaySclPins(snap.platform.type, snap, ctrl, sda).includes(sda + 1));
        d.gpio0 = withAdjacentScl ?? sdaCands[0] ?? 0;
        const sclCands = Domain.validDisplaySclPins(snap.platform.type, snap, ctrl, d.gpio0);
        d.gpio1 = sclCands.includes(d.gpio0 + 1) ? d.gpio0 + 1 : (sclCands[0] ?? 0);
      }
      return d;
    }
    const noun = nounOptionsFor(typeIdx)[0] ?? Domain.CsNoun.MasterVolume;
    const d: Draft = {
      type: typeIdx, noun, action: defaultAction(typeIdx, noun), event: Domain.CsEvent.Press,
      gpio0: 0, gpio1: 0, target: 0, index: 0,
      invert: false, reverse: false, wrap: false, accel: false, repeat: false,
      value: 0, step: 0, limitRange: false, rangeMin: 0, rangeMax: 0,
      onDelay: 0, offDelay: 0, limitBright: false, baseBright: 100,
      grouped: false, linkAbs: false, groupAll: false,
    };
    d.gpio0 = firstFree(candidatesFor(slot, -1, adcOnly(d)));
    if (twoPins(d)) d.gpio1 = firstFree(candidatesFor(slot, -1, false, d.gpio0));
    defaultOperands(d);
    return d;
  }

  function draftFromLive(b: Domain.CsBinding): Draft { return CsDraft.draftFromLive(b, cs.nouns); }

  function draftOf(slot: number): Draft {
    return drafts.draftOf(slot) ?? draftFromLive(cs.bindings[slot]!);
  }

  function editDraft(slot: number, fn: (d: Draft) => void): void {
    const d = drafts.draftOf(slot) ?? draftFromLive(cs.bindings[slot]!);
    fn(d);
    drafts.editDraft(slot, d);
  }

  function buildBinding(d: Draft): Domain.CsBinding { return CsDraft.buildBinding(d, cs.nouns, caps); }

  function nameChanged(slot: number, d: Draft | undefined): boolean {
    return d?.name !== undefined && d.name !== (cs.names[slot] ?? '');
  }

  function isDirty(slot: number): boolean {
    const live = cs.bindings[slot];
    if (!live) return true;                        // NEW: never applied
    const d = drafts.draftOf(slot);
    if (!d) return false;
    return nameChanged(slot, d) || !CsDraft.bindingsEqual(buildBinding(d), live);
  }

  function pill(slot: number): { text: string; cls: string } {
    const live = cs.bindings[slot];
    if (!live) return { text: 'NEW', cls: 'new' };
    if (cs.status && (cs.status.activeMask & (1 << slot))) return { text: 'ACTIVE', cls: 'ok' };
    return { text: 'INACTIVE', cls: 'warn' };
  }

  let pendingAdd = $state<number | null>(null);
  let renamingRaw = $state<number | null>(null);
  const renaming = $derived(renamingRaw != null && visibleSlots.includes(renamingRaw) ? renamingRaw : null);

  function addControl(e: Event): void {
    const sel = e.currentTarget as HTMLSelectElement;
    const typeIdx = Number(sel.value);
    sel.value = '';
    if (Number.isNaN(typeIdx)) return;
    pendingAdd = typeIdx;
  }

  function commitAdd(typeIdx: number, name: string): void {
    pendingAdd = null;
    const slot = SlotOps.firstFreeSlot(maxSlots, (i) => cs.bindings[i] != null || drafts.draftOf(i) != null);
    if (slot == null) return;
    const d = defaultDraft(typeIdx, slot);
    d.name = name;
    drafts.editDraft(slot, d);
    openSlot = slot;
  }

  // Rejections surface via the runtime actions' warn toasts; the panel's only
  // success feedback is the pill/staged-dot state flip.
  async function apply(slot: number): Promise<void> {
    const live = cs.bindings[slot];
    const d = drafts.draftOf(slot) ?? (live ? draftFromLive(live) : null);
    if (!d) return;
    const binding = buildBinding(d);
    const nameOnly = live != null && nameChanged(slot, d) && CsDraft.bindingsEqual(binding, live);
    await SlotOps.applySlot(slot, drafts, setApplying, async () => {
      const bindingOk = nameOnly || await applyCsBinding(s, slot, binding);
      return bindingOk && (!nameChanged(slot, d) || await applyCsName(s, slot, d.name!));
    });
  }

  function isIrSlot(slot: number): boolean {
    const d = drafts.draftOf(slot);
    return (d ? d.type : cs.bindings[slot]?.type) === Domain.CsType.Ir;
  }

  // IR sub-slot drafts belong to the receiver binding; once it goes away
  // they describe nothing and must stop counting as unapplied.
  function dropIrDrafts(): void { s.drafts.of('ir').clear(); }

  function revert(slot: number): void {
    drafts.revert(slot);
  }

  // Remove = drop a never-applied draft locally; clear a live slot on the
  // device (the all-zero binding).
  async function remove(slot: number): Promise<void> {
    const wasIr = isIrSlot(slot);
    const removed = await SlotOps.removeSlot(slot, cs.bindings[slot] != null, drafts, setApplying, () => clearCsBinding(s, slot));
    if (removed && wasIr) dropIrDrafts();
  }

  function renameSlot(slot: number, name: string): void {
    editDraft(slot, (d) => { d.name = name === (cs.names[slot] ?? '') ? undefined : name; });
  }

  // Any IR sub-slot holding unapplied edits lights the receiver slot's title
  // dot -- the sub-panel shows no dots of its own.
  const irDirty = $derived(s.drafts.dirtyCount('ir') > 0);

  $effect(() => {
    for (const slot of drafts.keys()) {
      const dirty = isDirty(slot);
      untrack(() => drafts.setDirty(slot, dirty));
    }
  });
</script>

<Panel title="CONTROL SURFACES">
  {#if caps}
    {#if visibleSlots.length === 0}
      <div class="hint cs-pad cs-empty">
        No controls configured. Wire a button, switch, knob, encoder, or LED to a
        spare GPIO and bind it to a device function.
      </div>
    {/if}

    {#each visibleSlots as slot (slot)}
      {@const d = draftOf(slot)}
      {@const p = pill(slot)}
      {@const slotDirty = isDirty(slot) || (d.type === Domain.CsType.Ir && irDirty)}
      <CsBindingRow
        {slot}
        draft={d}
        dirty={slotDirty}
        live={cs.bindings[slot] != null}
        pill={p}
        {applying}
        {detailTarget}
        {irDetailTarget}
        open={expanded === slot}
        onToggle={() => toggleSlot(slot)}
        onEdit={(fn) => editDraft(slot, fn)}
        onApply={() => apply(slot)}
        onRevert={() => revert(slot)}
        onRemove={() => remove(slot)}
        onRenameRequest={() => { renamingRaw = slot; }}
        renaming={renaming === slot}
        onRenameCommit={(name) => { renameSlot(slot, name); renamingRaw = null; }}
        onRenameCancel={() => { renamingRaw = null; }}
      />
    {/each}

    <div class="cs-addhost">
      <div class="cs-addrow">
        <select class="sel" value="" aria-label="Add control" disabled={applying || allUsed} onchange={addControl}>
          <option value="" disabled>ADD CONTROL…</option>
          {#each typeOptionsFor(-1) as t (t)}
            <option value={String(t)}>{Domain.csTypeLabel(t)}</option>
          {/each}
        </select>
        {#if allUsed}
          <span class="hint">All {maxSlots} control slots are in use.</span>
        {/if}
      </div>
      {#if pendingAdd != null}
        {@const typeIdx = pendingAdd}
        <CsNamePopover title={`NEW ${Domain.csTypeLabel(typeIdx).toUpperCase()}`} value=""
          onCommit={(name) => commitAdd(typeIdx, name)} onCancel={() => { pendingAdd = null; }} />
      {/if}
    </div>

  {:else if cs.lastFetchError}
    <div class="hint err cs-pad">{cs.lastFetchError}</div>
  {:else}
    <div class="hint cs-pad">Reading control-surface capabilities…</div>
  {/if}
</Panel>
