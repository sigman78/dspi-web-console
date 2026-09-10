<script lang="ts">
  import { untrack } from 'svelte';
  import Panel from '@/components/chrome/Panel.svelte';
  import CsBindingRow from './CsBindingRow.svelte';
  import { connection } from '@/state';
  import { applyCsBinding, clearCsBinding, applyCsName } from '@/runtime';
  import * as Domain from '@/domain';
  import { getSession } from '@/components/sessionContext';
  import * as CsDraft from './csDraft';
  import type { Draft } from './csDraft';
  import * as CsField from './csFieldHelpers';

  const s = getSession();
  const connected = $derived(connection.connected);
  const snap = $derived(s.mirror.current);
  const cs = $derived(s.controlSurfaces);
  const caps = $derived(s.controlSurfaces.caps);
  const busy = $derived(!connected);

  const drafts = $state<Record<number, Draft>>({});
  let applying = $state(false);

  const maxSlots = $derived(caps?.maxBindings ?? Domain.CS_MAX_BINDINGS);
  const visibleSlots = $derived(
    Array.from({ length: maxSlots }, (_, i) => i)
      .filter((i) => cs.bindings[i] != null || drafts[i] != null),
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
        if (cs.bindings[i]?.type === Domain.CsType.Ir || drafts[i]?.type === Domain.CsType.Ir) return i;
      }
      return null;
    })(),
  );
  // Firmware allows only one live display slot too (CS_STATUS_DISPLAY_IN_USE
  // on a second); same client-side nicety as irReceiverSlot above.
  const displaySlot = $derived(
    (() => {
      for (let i = 0; i < maxSlots; i++) {
        if (cs.bindings[i]?.type === Domain.CsType.Display || drafts[i]?.type === Domain.CsType.Display) return i;
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
    return drafts[slot] ?? draftFromLive(cs.bindings[slot]!);
  }

  function editDraft(slot: number, fn: (d: Draft) => void): void {
    const d = drafts[slot] ?? draftFromLive(cs.bindings[slot]!);
    fn(d);
    drafts[slot] = d;
  }

  function buildBinding(d: Draft): Domain.CsBinding { return CsDraft.buildBinding(d, cs.nouns, caps); }

  function isDirty(slot: number): boolean {
    const live = cs.bindings[slot];
    if (!live) return true;                        // NEW: never applied
    const d = drafts[slot];
    if (!d) return false;
    return !CsDraft.bindingsEqual(buildBinding(d), live);
  }

  function pill(slot: number): { text: string; cls: string } {
    const live = cs.bindings[slot];
    if (!live) return { text: 'NEW', cls: 'new' };
    if (cs.status && (cs.status.activeMask & (1 << slot))) return { text: 'ACTIVE', cls: 'ok' };
    return { text: 'INACTIVE', cls: 'warn' };
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
    openSlot = slot;
  }

  // Rejections surface via the runtime actions' warn toasts; the panel's only
  // success feedback is the pill/staged-dot state flip.
  async function apply(slot: number): Promise<void> {
    const live = cs.bindings[slot];
    const d = drafts[slot] ?? (live ? draftFromLive(live) : null);
    if (!d) return;
    applying = true;
    try {
      if (await applyCsBinding(s, slot, buildBinding(d))) {
        delete drafts[slot];                       // device truth takes over
      }
    } finally {
      applying = false;
    }
  }

  function revert(slot: number): void {
    delete drafts[slot];
  }

  // Remove = drop a never-applied draft locally; clear a live slot on the
  // device (the all-zero binding).
  async function remove(slot: number): Promise<void> {
    if (!cs.bindings[slot]) { delete drafts[slot]; return; }
    applying = true;
    try {
      if (await clearCsBinding(s, slot)) delete drafts[slot];
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

  let irResetTick = $state(0);
  // Written by CsIrCommands (bind): any IR sub-slot holds unapplied edits.
  // Lights the receiver slot's title dot -- the sub-panel shows no dots of
  // its own, dirtiness always surfaces on the owning control's title.
  let irDirty = $state(false);

  // A revert (the CHANGES panel's DISCARD) rewinds every slot and IR sub-slot
  // to its stored state, so local drafts no longer describe anything real;
  // cs.revertEpoch bumps on success. irResetTick tells CsIrCommands to drop
  // its own.
  $effect(() => {
    void cs.revertEpoch;   // the ONLY dependency -- the wipe must not track drafts
    untrack(() => {
      for (const key of Object.keys(drafts)) delete drafts[Number(key)];
      irResetTick++;
    });
  });

  const stagedCount = $derived(
    visibleSlots.filter((i) => isDirty(i) || (draftOf(i).type === Domain.CsType.Ir && irDirty)).length,
  );
  $effect(() => { s.controlSurfaces.staged.bindings = stagedCount; });
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
      {@const slotDirty = isDirty(slot) || (d.type === Domain.CsType.Ir && irDirty)}
      <CsBindingRow
        {slot}
        draft={d}
        dirty={slotDirty}
        pill={p}
        {applying}
        open={expanded === slot}
        onToggle={() => toggleSlot(slot)}
        typeOptions={typeOptionsFor(slot)}
        onEdit={(fn) => editDraft(slot, fn)}
        onTypeChange={(t) => { drafts[slot] = defaultDraft(t, slot); }}
        onApply={() => apply(slot)}
        onRevert={() => revert(slot)}
        onRemove={() => remove(slot)}
        onRename={(name) => renameSlot(slot, name)}
        irResetSignal={irResetTick}
        onIrDirtyChange={(v) => { irDirty = v; }}
      />
    {/each}

    <div class="addrow">
      <select class="sel" value="" aria-label="Add control" disabled={busy || applying || allUsed} onchange={addControl}>
        <option value="" disabled>ADD CONTROL…</option>
        {#each typeOptionsFor(-1) as t (t)}
          <option value={String(t)}>{Domain.csTypeLabel(t)}</option>
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
  .hint.err { color: var(--err); }
  .addrow { display: flex; align-items: center; gap: 10px; padding: 10px 14px 12px; }
  .empty { text-align: center; padding-top: 14px; }
  .pad { padding: 10px 14px; }
</style>
