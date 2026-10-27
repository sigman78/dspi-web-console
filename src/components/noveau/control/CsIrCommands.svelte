<script lang="ts">
  // The IR remote's learned commands (control_surfaces_spec.md 3.6): a fixed
  // table of CS_MAX_IR_COMMANDS sub-slots, device-global and independent of
  // which binding slot holds the receiver, so this section needs no slot
  // prop -- it renders once, under whichever slot's card holds the live
  // CS_TYPE_IR binding (see ControlSurfacesPanel).
  import { untrack } from 'svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import { pushNotice } from '@/state';
  import { applyCsIrCommand, clearCsIrCommand, csIrLearnArm, csIrLearnCancel } from '@/runtime';
  import * as Domain from '@/domain';
  import { csStatusFromByte } from '@/protocol';
  import { getSession } from '@/components/sessionContext';
  import CsTargetRow from './CsTargetRow.svelte';
  import CsValueStepRow from './CsValueStepRow.svelte';
  import * as CsField from '@/domain/cs/fieldHelpers';
  import * as CsDraft from '@/domain/cs/draft';
  import * as CsIr from '@/domain/cs/irDraft';
  import type { IrDraft } from '@/domain/cs/irDraft';
  import * as SlotOps from './csSlotOps';
  import { portal } from '@/components/chrome/portal';

  // irDetailTarget: when set, the commands section portals into that host and
  // shows one command at a time instead of all sub-slots inline.
  const { irDetailTarget = null }: { irDetailTarget?: HTMLElement | null } = $props();

  const s = getSession();
  const snap = $derived(s.mirror.current);
  const cs = $derived(s.controlSurfaces);
  const caps = $derived(s.controlSurfaces.caps);

  // Display units in the draft; wire units only at the buildIrCommand boundary.
  const drafts = s.drafts.of<IrDraft>('ir');
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

  // A config revert rewinds the stored commands, so a learn window or picked
  // row from before it no longer describes anything.
  $effect(() => {
    void cs.revertEpoch;   // the ONLY dependency -- the cleanup must not track drafts
    untrack(() => {
      armedSub = null;
      pickedSub = null;
    });
  });

  const maxSubs = $derived(caps?.maxIrCommands ?? Domain.CS_MAX_IR_COMMANDS);
  const subs = $derived(Array.from({ length: maxSubs }, (_, i) => i));

  // Collapsed by default -- eight rows dominate the slot card otherwise. The
  // header keeps the configured count and a staged dot visible either way.
  let open = $state(false);
  // Detached mode: the one expanded command. null = no pick yet (default
  // below), -1 = user collapsed all.
  let pickedSub = $state<number | null>(null);
  const openSub = $derived(
    pickedSub === -1 ? null
      : pickedSub != null ? pickedSub
        : (subs.find((i) => (draftOf(i)?.protocol ?? Domain.CsIrProto.None) !== Domain.CsIrProto.None) ?? 0),
  );
  const configured = $derived(cs.irCommands.filter((c) => c != null).length);

  $effect(() => {
    for (const sub of drafts.keys()) {
      const dirty = isDirty(sub);
      untrack(() => drafts.setDirty(sub, dirty));
    }
  });

  function nounOptions(): number[] { return CsIr.irNounOptions(caps, cs.nouns); }
  function actionOptions(noun: number): Domain.CsAction[] { return CsIr.irActionOptions(caps, cs.nouns, noun); }

  // null = never touched: no live command, no local draft. Rendered as the
  // bare "not learned" row with only a LEARN button.
  function draftOf(sub: number): IrDraft | null {
    const d = drafts.draftOf(sub);
    if (d) return d;
    const live = cs.irCommands[sub];
    return live ? CsIr.irDraftFromLive(live, cs.nouns) : null;
  }

  function editDraft(sub: number, fn: (d: IrDraft) => void): void {
    const d = drafts.draftOf(sub) ?? draftOf(sub) ?? CsIr.defaultIrDraft(caps, cs.nouns);
    fn(d);
    drafts.editDraft(sub, d);
  }

  function buildCommand(d: IrDraft): Domain.CsIrCommand { return CsIr.buildIrCommand(d, cs.nouns, caps); }

  function isDirty(sub: number): boolean {
    const d = draftOf(sub);
    if (!d) return false;
    const live = cs.irCommands[sub] ?? Domain.EMPTY_CS_IR_COMMAND;
    return !CsIr.irCommandsEqual(buildCommand(d), live);
  }

  // APPLY stays disabled on an unlearned code even if the rest of the row
  // validates -- a code of 0 is only legal on the all-zero (cleared) command.
  function canApply(sub: number): boolean {
    const d = draftOf(sub);
    if (!d || !caps || d.protocol === Domain.CsIrProto.None || !isDirty(sub)) return false;
    return Domain.validateCsIrCommand(buildCommand(d), caps, cs.nouns, cs.groups) === 0;
  }

  // Row lifecycle: NOT LEARNED -> LEARNED (code captured, awaiting APPLY) ->
  // ACTIVE/INACTIVE (applied; device truth from irActiveMask).
  function pill(sub: number, d: IrDraft | null): { text: string; cls: string } {
    if (!cs.irCommands[sub]) {
      return { text: d && d.protocol !== Domain.CsIrProto.None ? 'LEARNED' : 'NOT LEARNED', cls: 'new' };
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

  function setBusy(busy: boolean, sub: number): void { applyingSub = busy ? sub : null; }

  async function apply(sub: number): Promise<void> {
    const d = draftOf(sub);
    if (!d) return;
    await SlotOps.applySlot(sub, drafts, (b) => setBusy(b, sub), () => applyCsIrCommand(s, sub, buildCommand(d)));
  }

  // Clear = drop a never-applied draft locally, or clear a live sub-slot on
  // the device (the all-zero command). Rejections surface via the runtime
  // actions' warn toasts.
  async function clear(sub: number): Promise<void> {
    await SlotOps.removeSlot(sub, cs.irCommands[sub] != null, drafts, (b) => setBusy(b, sub), () => clearCsIrCommand(s, sub));
  }

  // Arming always ensures a draft exists first, so the armed row always has
  // one to receive the learned code, and the user can pick noun/action while
  // the 10 s listening window is still open.
  async function learn(sub: number): Promise<void> {
    if (armedSub != null) return;
    pickedSub = sub;
    if (!drafts.draftOf(sub)) drafts.editDraft(sub, draftOf(sub) ?? CsIr.defaultIrDraft(caps, cs.nouns));
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
</script>

{#snippet editor(sub: number, d: IrDraft)}
          {@const actions = actionOptions(d.noun)}
          {#if pill(sub, d).cls === 'warn'}
            <div class="hint err">{inactiveHint(sub)}</div>
          {/if}

          <div class="row">
            <span class="microlbl">CONTROLS</span>
            <select class="sel" value={String(d.noun)} aria-label="Controlled function" disabled={applyingSub != null}
              onchange={(e) => {
                const n = Number((e.currentTarget as HTMLSelectElement).value);
                editDraft(sub, (dr) => {
                  dr.noun = n; dr.target = 0; dr.index = 0; dr.grouped = false;
                  const legal = actionOptions(n);
                  if (!legal.includes(dr.action as Domain.CsAction)) dr.action = CsDraft.defaultAction(Domain.CsType.Ir, n, caps, cs.nouns);
                  CsIr.defaultIrOperands(dr, cs.nouns);
                });
              }}>
              {#each nounOptions() as n (n)}
                <option value={String(n)}>{Domain.csNounLabel(n)}</option>
              {/each}
            </select>
            {#if actions.length > 1}
              <span class="microlbl">ACTION</span>
              <select class="sel" value={String(d.action)} aria-label="Action" disabled={applyingSub != null}
                onchange={(e) => {
                  const a = Number((e.currentTarget as HTMLSelectElement).value);
                  editDraft(sub, (dr) => { dr.action = a; CsIr.defaultIrOperands(dr, cs.nouns); });
                }}>
                {#each actions as a (a)}
                  <option value={String(a)}>{Domain.csActionLabel(a, CsField.enumOf(cs.nouns, d.noun))}</option>
                {/each}
              </select>
            {/if}
          </div>

          {#if CsField.showTargetOf(cs.nouns, d.noun)}
            <div class="row">
              <CsTargetRow nouns={cs.nouns} noun={d.noun} target={d.target} index={d.index} grouped={d.grouped}
                channels={snap?.channels ?? []} groups={cs.groups} groupsEnabled={CsIr.irGroupsAvailable(caps)}
                disabled={applyingSub != null}
                onTarget={(pick) => editDraft(sub, (dr) => { dr.grouped = pick.grouped; dr.target = pick.target; dr.index = 0; })}
                onBand={(v) => editDraft(sub, (dr) => { dr.index = v; })} />
            </div>
          {/if}

          {#if d.noun !== Domain.CsNoun.PageValue && (CsField.showValueOf(d.action) || CsField.showStepOf(d.action, CsIr.IR_STEPPY))}
            <div class="row">
              <CsValueStepRow nouns={cs.nouns} noun={d.noun} action={d.action} steppy={CsIr.IR_STEPPY} presetNames={s.presets.names} macros={cs.macros} displayPages={cs.displayPages}
                value={d.value} step={d.step} disabled={applyingSub != null}
                onValue={(v) => editDraft(sub, (dr) => { dr.value = v; })}
                onStep={(v) => editDraft(sub, (dr) => { dr.step = v; })} />
            </div>
          {/if}

          {#if CsField.showWrapOf(cs.nouns, d.noun, d.action, CsIr.IR_STEPPY) || d.action === Domain.CsAction.Inc || d.action === Domain.CsAction.Dec}
            <div class="row">
              {#if CsField.showWrapOf(cs.nouns, d.noun, d.action, CsIr.IR_STEPPY)}
                <span class="microlbl">WRAP AROUND</span>
                <ToggleSwitch checked={d.wrap} disabled={applyingSub != null}
                  ariaLabel="Wrap around" onChange={(v) => editDraft(sub, (dr) => { dr.wrap = v; })} />
              {/if}
              {#if d.action === Domain.CsAction.Inc || d.action === Domain.CsAction.Dec}
                <span class="microlbl">AUTO-REPEAT WHILE HELD</span>
                <ToggleSwitch checked={d.repeat} disabled={applyingSub != null}
                  ariaLabel="Auto-repeat while held" onChange={(v) => editDraft(sub, (dr) => { dr.repeat = v; })} />
              {/if}
            </div>
          {/if}

          <div class="row">
            <button type="button" class="chip accent" onclick={() => apply(sub)}
              disabled={applyingSub != null || !canApply(sub)}>APPLY</button>
          </div>
{/snippet}

{#snippet commandsBody()}
  <div class="irbody">
    {#each subs as sub (sub)}
      {@const d = draftOf(sub)}
      {@const listening = armedSub === sub}
      {#if irDetailTarget}
        {@const isOpen = openSub === sub}
        {@const learned = d != null && d.protocol !== Domain.CsIrProto.None}
        {@const p = pill(sub, d)}
        <div class="irrow compact" class:openrow={isOpen}>
          <div class="sumrow">
            <button type="button" class="sumbtn" aria-expanded={isOpen} aria-label={`IR command ${sub + 1}`}
              onclick={() => { pickedSub = isOpen ? -1 : sub; }}>
              <span class="arrow">{isOpen ? '▾' : '▸'}</span>
              <span class="idx">{sub + 1}</span>
              <span class="cs-pill {p.cls}">{p.text}</span>
              <span class="sumtxt" class:dim={!learned}>
                {#if listening}
                  Press a button on the remote… <span class="count">{Math.max(0, learnRemaining)}s</span>
                {:else if learned && d}
                  {Domain.csNounLabel(d.noun)} · {Domain.csActionLabel(d.action as Domain.CsAction, CsField.enumOf(cs.nouns, d.noun))}
                {:else}
                  —
                {/if}
              </span>
            </button>
            {#if listening}
              <button type="button" class="chip hi" onclick={cancelLearn}>CANCEL</button>
            {:else}
              <button type="button" class="chip"
                disabled={applyingSub != null || (armedSub != null && armedSub !== sub)}
                onclick={() => learn(sub)}>{learned ? 'RE-LEARN' : 'LEARN'}</button>
            {/if}
          </div>
          {#if isOpen && d}
            <div class="row">
              <span class="code" class:learned>{codeText(d)}</span>
              <span class="spacer"></span>
              <button type="button" class="chip hi" disabled={applyingSub != null || listening}
                onclick={() => clear(sub)}>CLEAR</button>
            </div>
            {@render editor(sub, d)}
          {/if}
        </div>
      {:else}
      <div class="irrow">
        <div class="row">
          {#if d}
            <span class="code" class:learned={d.protocol !== Domain.CsIrProto.None}>{codeText(d)}</span>
            {@const p = pill(sub, d)}
            <span class="cs-pill {p.cls}">{p.text}</span>
          {:else}
            <span class="code">Not learned</span>
          {/if}
          <span class="spacer"></span>
          {#if listening}
            <span class="hint listen">Press a button on the remote… <span class="count">{Math.max(0, learnRemaining)}s</span></span>
            <button type="button" class="chip hi" onclick={cancelLearn}>CANCEL</button>
          {:else}
            <button type="button" class="chip"
              disabled={applyingSub != null || (armedSub != null && armedSub !== sub)}
              onclick={() => learn(sub)}>{d && d.protocol !== Domain.CsIrProto.None ? 'RE-LEARN' : 'LEARN'}</button>
          {/if}
          {#if d}
            <button type="button" class="chip hi" disabled={applyingSub != null || listening}
              onclick={() => clear(sub)}>CLEAR</button>
          {/if}
        </div>

        {#if d}
          {@render editor(sub, d)}
        {/if}
      </div>
      {/if}
    {/each}
  </div>
{/snippet}

<div class="ircommands">
  {#if irDetailTarget}
    <div class="irtoggle static">
      <span class="irtitle">IR COMMANDS</span>
      <span class="ircnt">{configured} / {maxSubs}</span>
      <span class="ircap">{maxSubs} command slots · edited in the IR COMMANDS column</span>
    </div>
  {/if}
  {#if irDetailTarget}
    <div class="detached" use:portal={irDetailTarget}>
      {@render commandsBody()}
    </div>
  {:else}
    <button type="button" class="irtoggle" aria-expanded={open} onclick={() => { open = !open; }}>
      <span class="arrow">{open ? '▾' : '▸'}</span>
      <span class="irtitle">IR COMMANDS</span>
      <span class="ircnt">{configured} / {maxSubs}</span>
    </button>
    {#if open}
      {@render commandsBody()}
    {/if}
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
  .irtoggle.static { cursor: default; flex-wrap: wrap; }
  .ircap { font-size: 11px; color: var(--text-faint); }
  .irtoggle:not(.static):hover .irtitle { color: var(--text); }
  .arrow { font-size: 9px; color: var(--text-faint); }
  .irtitle {
    font-family: var(--font-sans);
    font-size: var(--fs-m);
    font-weight: 600;
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
  .irrow.compact { padding: 0 4px; gap: 4px; }
  .irrow.compact.openrow { padding-bottom: 6px; }
  .detached .irbody { gap: 0; }
  .irrow.compact:not(.openrow) { border-bottom: none; }
  .sumrow { display: flex; align-items: center; gap: 6px; height: var(--h-row); }
  .sumbtn {
    flex: 1;
    min-width: 0;
    height: var(--h-row);
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font-family: var(--font-mono);
    text-align: left;
  }
  .idx { font-size: 11px; color: var(--text-faint); min-width: 14px; }
  .sumtxt {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sumtxt.dim { color: var(--text-faint); }
  .detached { display: flex; flex-direction: column; }
  .irrow:not(:last-child) { border-bottom: 1px solid var(--wash); }
  .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .code {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-faint);
  }
  .code.learned { color: var(--text-dim); }
  .spacer { flex: 1; }
  .hint.listen { color: var(--text-dim); }
  .count {
    font-family: var(--font-mono);
    font-weight: 700;
    color: var(--accent);
  }
</style>
