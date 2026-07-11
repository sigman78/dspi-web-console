<script lang="ts">
  // The IR remote's learned commands (control_surfaces_spec.md 3.6): a fixed
  // table of CS_MAX_IR_COMMANDS sub-slots, device-global and independent of
  // which binding slot holds the receiver, so this section needs no slot
  // prop -- it renders once, under whichever slot's card holds the live
  // CS_TYPE_IR binding (see ControlSurfacesPanel).
  import { untrack } from 'svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import { connection, pushNotice } from '@/state';
  import { applyCsIrCommand, clearCsIrCommand, csIrLearnArm, csIrLearnCancel } from '@/runtime';
  import * as Domain from '@/domain';
  import { csStatusFromByte } from '@/protocol';
  import { getSession } from '@/components/sessionContext';
  import * as CsUnit from './csUnitDisplay';
  import * as CsField from './csFieldHelpers';

  // resetSignal: bumped by the parent after csRevertConfig() re-fetches
  // cs.irCommands, so a local draft or in-flight learn message from before
  // the revert doesn't linger over the restored device truth.
  // onDirtyChange: reports "some sub-slot has unapplied edits" upward -- the
  // parent lights the receiver slot's title dot; no dots render here.
  const { resetSignal = 0, onDirtyChange }: {
    resetSignal?: number;
    onDirtyChange?: (dirty: boolean) => void;
  } = $props();

  const s = getSession();
  const connected = $derived(connection.connected);
  const snap = $derived(s.mirror.current);
  const cs = $derived(s.controlSurfaces);
  const caps = $derived(s.controlSurfaces.caps);
  const busy = $derived(!connected);

  // Sub-slot local drafts, same shape/units convention as the binding editor's
  // Draft (see ControlSurfacesPanel): display units in the draft, wire units
  // only at the buildIrCommand() boundary.
  interface IrDraft {
    noun: number; action: number;
    target: number; index: number;
    protocol: number; code: number;
    value: number; step: number;
    wrap: boolean; repeat: boolean;
  }
  const drafts = $state<Record<number, IrDraft>>({});
  let applyingSub = $state<number | null>(null);
  // The sub-slot that armed the current learn window; only one may be armed
  // (control_surfaces_spec.md 3.6.1).
  let armedSub = $state<number | null>(null);

  // Countdown mirror of the firmware's 10 s listen window, for display only --
  // completion truth is the notify event. The 2 s grace past zero is a lost-
  // notify fallback so a row can never hang in "listening".
  const LEARN_WINDOW_S = 10;
  let learnRemaining = $state(LEARN_WINDOW_S);

  $effect(() => {
    if (armedSub == null) return;
    learnRemaining = LEARN_WINDOW_S;
    const t = setInterval(() => {
      learnRemaining -= 1;
      if (learnRemaining <= -2) {
        untrack(() => {
          if (armedSub != null) {
            pushNotice('warn', 'IR learn: no remote button was detected — try again.');
            armedSub = null;   // triggers this effect's cleanup
          }
        });
      }
    }, 1000);
    return () => clearInterval(t);
  });

  $effect(() => {
    void resetSignal;   // the ONLY dependency -- the cleanup must not track
    untrack(() => {     // drafts, or any draft edit re-runs the wipe
      for (const k of Object.keys(drafts)) delete drafts[Number(k)];
      armedSub = null;
    });
  });

  const maxSubs = $derived(caps?.maxIrCommands ?? Domain.CS_MAX_IR_COMMANDS);
  const subs = $derived(Array.from({ length: maxSubs }, (_, i) => i));

  // Collapsed by default -- eight rows dominate the slot card otherwise. The
  // header keeps the configured count and a staged dot visible either way.
  let open = $state(false);
  const configured = $derived(cs.irCommands.filter((c) => c != null).length);

  $effect(() => { onDirtyChange?.(subs.some((sub) => isDirty(sub))); });

  // The button-shaped action subset IR commands may carry (same nouns as the
  // main panel, but scoped to the CS_TYPE_IR type descriptor's action mask).
  const IR_STEPPY: readonly number[] = [Domain.CsAction.Inc, Domain.CsAction.Dec];

  function nounOptions(): number[] {
    if (!caps) return [];
    const mask = caps.types[Domain.CsType.Ir]?.actions ?? 0;
    return cs.nouns.map((_, i) => i).filter((i) => (cs.nouns[i].actions & mask) !== 0);
  }
  function actionOptions(noun: number): Domain.CsAction[] {
    if (!caps) return [];
    return Domain.legalActions(caps.types[Domain.CsType.Ir]?.actions ?? 0, cs.nouns[noun]?.actions ?? 0);
  }
  function defaultAction(noun: number): number { return actionOptions(noun)[0] ?? 0; }

  function defaultIrOperands(d: IrDraft): void {
    const noun = cs.nouns[d.noun];
    const cont = noun?.kind === Domain.CsKind.Continuous;
    const bool = noun?.kind === Domain.CsKind.Bool;
    const unit = noun?.unit ?? Domain.CS_UNIT_NONE;
    d.step = !IR_STEPPY.includes(d.action) ? 0 : CsUnit.isLogStep(unit) ? 0 : 1;
    if (d.action === Domain.CsAction.Set || d.action === Domain.CsAction.Momentary) {
      d.value = noun && cont ? CsUnit.valueToDisplay(unit, noun.maxQ8) : bool ? 1 : 0;
    } else {
      d.value = 0;
    }
    d.wrap = false;
    d.repeat = false;
  }

  function defaultIrDraft(): IrDraft {
    const noun = nounOptions()[0] ?? Domain.CsNoun.UserVolume;
    const d: IrDraft = {
      noun, action: defaultAction(noun), target: 0, index: 0,
      protocol: Domain.CsIrProto.None, code: 0, value: 0, step: 0, wrap: false, repeat: false,
    };
    defaultIrOperands(d);
    return d;
  }

  function irDraftFromLive(c: Domain.CsIrCommand): IrDraft {
    const noun = cs.nouns[c.noun];
    const cont = noun?.kind === Domain.CsKind.Continuous;
    const unit = noun?.unit ?? Domain.CS_UNIT_NONE;
    return {
      noun: c.noun, action: c.action, target: c.target, index: c.index,
      protocol: c.protocol, code: c.code,
      value: cont ? CsUnit.valueToDisplay(unit, c.value) : c.value,
      step: cont ? CsUnit.stepToDisplay(unit, c.step) : c.step,
      wrap: (c.flags & Domain.CS_FLAG_WRAP) !== 0,
      repeat: (c.flags & Domain.CS_FLAG_REPEAT) !== 0,
    };
  }

  // null = never touched: no live command, no local draft. Rendered as the
  // bare "not learned" row with only a LEARN button.
  function draftOf(sub: number): IrDraft | null {
    const d = drafts[sub];
    if (d) return d;
    const live = cs.irCommands[sub];
    return live ? irDraftFromLive(live) : null;
  }

  function editDraft(sub: number, fn: (d: IrDraft) => void): void {
    const d = drafts[sub] ?? draftOf(sub) ?? defaultIrDraft();
    fn(d);
    drafts[sub] = d;
  }

  function buildIrCommand(d: IrDraft): Domain.CsIrCommand {
    const noun = cs.nouns[d.noun];
    const cont = noun?.kind === Domain.CsKind.Continuous;
    const unit = noun?.unit ?? Domain.CS_UNIT_NONE;
    const repeatEligible = d.action === Domain.CsAction.Inc || d.action === Domain.CsAction.Dec;
    return {
      noun: d.noun as Domain.CsNoun,
      action: d.action as Domain.CsAction,
      flags: (CsField.showWrapOf(cs.nouns, d.noun, d.action, IR_STEPPY) && d.wrap ? Domain.CS_FLAG_WRAP : 0)
        | (repeatEligible && d.repeat ? Domain.CS_FLAG_REPEAT : 0),
      target: CsField.showTargetOf(cs.nouns, d.noun) ? d.target : 0,
      index: CsField.showBandOf(cs.nouns, d.noun) ? d.index : 0,
      protocol: d.protocol as Domain.CsIrProto,
      value: CsField.showValueOf(d.action) ? (cont ? CsUnit.displayToValue(unit, d.value) : Math.round(d.value)) : 0,
      step: CsField.showStepOf(d.action, IR_STEPPY) ? (cont ? CsUnit.displayToStep(unit, d.step) : Math.round(d.step)) : 0,
      code: d.code,
    };
  }

  function irCommandsEqual(a: Domain.CsIrCommand, b: Domain.CsIrCommand): boolean {
    return a.noun === b.noun && a.action === b.action && a.flags === b.flags
      && a.target === b.target && a.index === b.index && a.protocol === b.protocol
      && a.value === b.value && a.step === b.step && a.code === b.code;
  }

  function isDirty(sub: number): boolean {
    const d = draftOf(sub);
    if (!d) return false;
    const live = cs.irCommands[sub] ?? Domain.EMPTY_CS_IR_COMMAND;
    return !irCommandsEqual(buildIrCommand(d), live);
  }

  // APPLY stays disabled on an unlearned code even if the rest of the row
  // validates -- a code of 0 is only legal on the all-zero (cleared) command.
  function canApply(sub: number): boolean {
    const d = draftOf(sub);
    if (!d || !caps || d.protocol === Domain.CsIrProto.None || !isDirty(sub)) return false;
    return Domain.validateCsIrCommand(buildIrCommand(d), caps, cs.nouns) === 0;
  }

  // Row lifecycle: NOT LEARNED -> LEARNED (code captured, awaiting APPLY) ->
  // ACTIVE/INACTIVE (applied; device truth from irActiveMask).
  function pill(sub: number, d: IrDraft): { text: string; cls: string } {
    if (!cs.irCommands[sub]) {
      return d.protocol !== Domain.CsIrProto.None
        ? { text: 'LEARNED', cls: 'new' }
        : { text: 'NOT LEARNED', cls: 'new' };
    }
    if (cs.status && (cs.status.irActiveMask & (1 << sub))) return { text: 'ACTIVE', cls: 'ok' };
    return { text: 'INACTIVE', cls: 'warn' };
  }

  function inactiveHint(sub: number): string {
    const byte = cs.status?.irCmdStatus[sub] ?? 0;
    const r = csStatusFromByte(byte);
    const why = r.ok ? 'failed to apply' : r.message.toLowerCase();
    return `Not running: ${why}. Adjust and re-apply.`;
  }

  function codeText(d: IrDraft): string {
    if (d.protocol === Domain.CsIrProto.None) return 'Not learned';
    const proto = Domain.CS_IR_PROTO_LABEL[d.protocol as Domain.CsIrProto];
    return `${proto} · 0x${(d.code >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
  }

  async function apply(sub: number): Promise<void> {
    const d = draftOf(sub);
    if (!d) return;
    applyingSub = sub;
    try {
      if (await applyCsIrCommand(s, sub, buildIrCommand(d))) {
        delete drafts[sub];                       // device truth takes over
      }
    } finally {
      applyingSub = null;
    }
  }

  // Clear = drop a never-applied draft locally, or clear a live sub-slot on
  // the device (the all-zero command). Rejections surface via the runtime
  // actions' warn toasts.
  async function clear(sub: number): Promise<void> {
    if (!cs.irCommands[sub]) { delete drafts[sub]; return; }
    applyingSub = sub;
    try {
      if (await clearCsIrCommand(s, sub)) delete drafts[sub];
    } finally {
      applyingSub = null;
    }
  }

  // Arming always ensures a draft exists first, so "the armed row's draft"
  // (see finishLearn below) is never null, and the user can pick noun/action
  // while the 10 s listening window is still open.
  async function learn(sub: number): Promise<void> {
    if (armedSub != null) return;
    if (!drafts[sub]) drafts[sub] = draftOf(sub) ?? defaultIrDraft();
    armedSub = sub;
    const ok = await csIrLearnArm(s);
    if (!ok) armedSub = null;   // failure (no live receiver) already surfaced via pushNotice
  }

  async function cancelLearn(): Promise<void> {
    armedSub = null;
    await csIrLearnCancel(s);
  }

  $effect(() => {
    const learn = cs.irLearn;
    const sub = armedSub;
    if (!learn || sub == null) return;
    untrack(() => {   // consume the result; draft writes must not re-trigger
      if (learn.state === Domain.CS_IR_LEARN_DONE) {
        editDraft(sub, (d) => { d.protocol = learn.protocol; d.code = learn.code; });
        armedSub = null;   // the pill flips to LEARNED; APPLY is the next step
      } else if (learn.state === Domain.CS_IR_LEARN_TIMEOUT) {
        pushNotice('warn', 'IR learn: no remote button was detected — try again.');
        armedSub = null;
      }
    });
  });

  function num(e: Event): number | null {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    return Number.isNaN(v) ? null : v;
  }
</script>

<div class="ircommands">
  <button type="button" class="irtoggle" aria-expanded={open} onclick={() => { open = !open; }}>
    <span class="arrow">{open ? '▾' : '▸'}</span>
    <span class="irtitle">IR COMMANDS</span>
    <span class="ircnt">{configured} / {maxSubs}</span>
  </button>
  {#if open}
  <div class="irbody">
    {#each subs as sub (sub)}
      {@const d = draftOf(sub)}
      {@const listening = armedSub === sub}
      <div class="irrow">
        <div class="row">
          {#if d}
            <span class="code" class:learned={d.protocol !== Domain.CsIrProto.None}>{codeText(d)}</span>
            {@const p = pill(sub, d)}
            <span class="pill {p.cls}">{p.text}</span>
          {:else}
            <span class="code">Not learned</span>
          {/if}
          <span class="spacer"></span>
          {#if listening}
            <span class="hint listen">Press a button on the remote… <span class="count">{Math.max(0, learnRemaining)}s</span></span>
            <button type="button" class="chip hi" onclick={cancelLearn}>CANCEL</button>
          {:else}
            <button type="button" class="chip"
              disabled={busy || applyingSub != null || (armedSub != null && armedSub !== sub)}
              onclick={() => learn(sub)}>{d && d.protocol !== Domain.CsIrProto.None ? 'RE-LEARN' : 'LEARN'}</button>
          {/if}
          {#if d}
            <button type="button" class="chip hi" disabled={busy || applyingSub != null || listening}
              onclick={() => clear(sub)}>CLEAR</button>
          {/if}
        </div>

        {#if d}
          {@const actions = actionOptions(d.noun)}
          {#if pill(sub, d).cls === 'warn'}
            <div class="hint err">{inactiveHint(sub)}</div>
          {/if}

          <div class="row">
            <span class="microlbl">CONTROLS</span>
            <select class="sel" value={String(d.noun)} aria-label="Controlled function" disabled={busy || applyingSub != null}
              onchange={(e) => {
                const n = Number((e.currentTarget as HTMLSelectElement).value);
                editDraft(sub, (dr) => {
                  dr.noun = n; dr.target = 0; dr.index = 0;
                  const legal = actionOptions(n);
                  if (!legal.includes(dr.action as Domain.CsAction)) dr.action = defaultAction(n);
                  defaultIrOperands(dr);
                });
              }}>
              {#each nounOptions() as n (n)}
                <option value={String(n)}>{Domain.CS_NOUN_LABEL[n as Domain.CsNoun]}</option>
              {/each}
            </select>
            {#if actions.length > 1}
              <span class="microlbl">ACTION</span>
              <select class="sel" value={String(d.action)} aria-label="Action" disabled={busy || applyingSub != null}
                onchange={(e) => {
                  const a = Number((e.currentTarget as HTMLSelectElement).value);
                  editDraft(sub, (dr) => { dr.action = a; defaultIrOperands(dr); });
                }}>
                {#each actions as a (a)}
                  <option value={String(a)}>{Domain.csActionLabel(a, CsField.enumOf(cs.nouns, d.noun))}</option>
                {/each}
              </select>
            {/if}
          </div>

          {#if CsField.showTargetOf(cs.nouns, d.noun)}
            <div class="row">
              <span class="microlbl">
                {CsField.targetKindOf(cs.nouns, d.noun) === Domain.CS_TARGET_INPUT_CH ? 'INPUT'
                  : CsField.targetKindOf(cs.nouns, d.noun) === Domain.CS_TARGET_OUTPUT_CH ? 'OUTPUT' : 'CHANNEL'}
              </span>
              <select class="sel" value={String(d.target)} aria-label="Target channel" disabled={busy || applyingSub != null}
                onchange={(e) => { const v = Number((e.currentTarget as HTMLSelectElement).value); editDraft(sub, (dr) => { dr.target = v; dr.index = 0; }); }}>
                {#each (snap ? CsField.targetOptionsFor(cs.nouns, d.noun, snap.channels) : []) as o (o.v)}
                  <option value={String(o.v)}>{o.label}</option>
                {/each}
              </select>
              {#if CsField.showBandOf(cs.nouns, d.noun)}
                <span class="microlbl">BAND</span>
                <select class="sel" value={String(d.index)} aria-label="Filter band" disabled={busy || applyingSub != null}
                  onchange={(e) => { const v = Number((e.currentTarget as HTMLSelectElement).value); editDraft(sub, (dr) => { dr.index = v; }); }}>
                  {#each (snap ? CsField.bandOptionsFor(d.noun, d.target, snap.channels) : []) as o (o.v)}
                    <option value={String(o.v)}>{o.label}</option>
                  {/each}
                </select>
              {/if}
            </div>
          {/if}

          {#if CsField.showValueOf(d.action) || CsField.showStepOf(d.action, IR_STEPPY)}
            <div class="row">
              {#if CsField.showValueOf(d.action)}
                <span class="microlbl">{CsField.valueLabel(d.action, CsField.contOf(cs.nouns, d.noun))}</span>
                {#if CsField.contOf(cs.nouns, d.noun)}
                  <input class="numfield" type="number" step="0.5"
                    min={cs.nouns[d.noun] ? CsUnit.valueToDisplay(CsField.unitOf(cs.nouns, d.noun), cs.nouns[d.noun].minQ8) : 0}
                    max={cs.nouns[d.noun] ? CsUnit.valueToDisplay(CsField.unitOf(cs.nouns, d.noun), cs.nouns[d.noun].maxQ8) : 0}
                    value={d.value} aria-label="Value" disabled={busy || applyingSub != null}
                    onchange={(e) => { const v = num(e); if (v != null) editDraft(sub, (dr) => { dr.value = v; }); }} />
                  <span class="hint">{CsUnit.unitSuffix(CsField.unitOf(cs.nouns, d.noun))}</span>
                {:else}
                  <select class="sel" value={String(d.value)} aria-label="Value" disabled={busy || applyingSub != null}
                    onchange={(e) => { const v = Number((e.currentTarget as HTMLSelectElement).value); editDraft(sub, (dr) => { dr.value = v; }); }}>
                    {#each (CsField.enumOf(cs.nouns, d.noun) ? CsField.enumValueOptions(cs.nouns, d.noun, s.presets.names) : CsField.boolValueOptions(d.noun)) as o (o.v)}
                      <option value={String(o.v)}>{o.label}</option>
                    {/each}
                  </select>
                {/if}
              {/if}
              {#if CsField.showStepOf(d.action, IR_STEPPY)}
                <span class="microlbl">STEP SIZE</span>
                {#if CsField.enumOf(cs.nouns, d.noun)}
                  <input class="numfield" type="number" step="1" min="1"
                    max={Math.max(1, (cs.nouns[d.noun]?.enumCount ?? 2) - 1)}
                    value={d.step} aria-label="Step size (positions)" disabled={busy || applyingSub != null}
                    onchange={(e) => { const v = num(e); if (v != null) editDraft(sub, (dr) => { dr.step = v; }); }} />
                {:else}
                  <input class="numfield" type="number" step={CsUnit.isLogStep(CsField.unitOf(cs.nouns, d.noun)) ? '0.01' : '0.5'} min="0"
                    value={d.step} aria-label="Step size" disabled={busy || applyingSub != null}
                    onchange={(e) => { const v = num(e); if (v != null) editDraft(sub, (dr) => { dr.step = v; }); }} />
                  <span class="hint">{CsUnit.stepUnitSuffix(CsField.unitOf(cs.nouns, d.noun))}</span>
                {/if}
              {/if}
            </div>
          {/if}

          {#if CsField.showWrapOf(cs.nouns, d.noun, d.action, IR_STEPPY) || d.action === Domain.CsAction.Inc || d.action === Domain.CsAction.Dec}
            <div class="row">
              {#if CsField.showWrapOf(cs.nouns, d.noun, d.action, IR_STEPPY)}
                <span class="microlbl">WRAP AROUND</span>
                <ToggleSwitch size="sm" checked={d.wrap} disabled={busy || applyingSub != null}
                  ariaLabel="Wrap around" onChange={(v) => editDraft(sub, (dr) => { dr.wrap = v; })} />
              {/if}
              {#if d.action === Domain.CsAction.Inc || d.action === Domain.CsAction.Dec}
                <span class="microlbl">AUTO-REPEAT WHILE HELD</span>
                <ToggleSwitch size="sm" checked={d.repeat} disabled={busy || applyingSub != null}
                  ariaLabel="Auto-repeat while held" onChange={(v) => editDraft(sub, (dr) => { dr.repeat = v; })} />
              {/if}
            </div>
          {/if}

          <div class="row">
            <button type="button" class="chip accent" onclick={() => apply(sub)}
              disabled={busy || applyingSub != null || !canApply(sub)}>APPLY</button>
          </div>
        {/if}
      </div>
    {/each}
  </div>
  {/if}
</div>

<style>
  .ircommands { border-top: 1px solid var(--wash); }
  .irtoggle {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    background: none;
    border: none;
    cursor: pointer;
    font-family: var(--font-mono);
    text-align: left;
  }
  .irtoggle:hover .irtitle { color: var(--text); }
  .arrow { font-size: 9px; color: var(--text-faint); }
  .irtitle {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1.2px;
    color: var(--text-dim);
  }
  .ircnt {
    font-size: 9px;
    color: var(--text-faint);
  }
  .irbody { padding: 0 14px 10px; display: flex; flex-direction: column; gap: 4px; }
  .irrow {
    padding: 8px 8px;
    border-radius: var(--radius-s);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .irrow:not(:last-child) { border-bottom: 1px solid var(--wash); }
  .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .code {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-faint);
  }
  .code.learned { color: var(--text-dim); }
  .spacer { flex: 1; }
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
  .hint.listen { color: var(--text-dim); }
  .count {
    font-family: var(--font-mono);
    font-weight: 700;
    color: var(--accent);
  }
</style>
