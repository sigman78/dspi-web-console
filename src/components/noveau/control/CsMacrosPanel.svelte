<script lang="ts">
  // Macros (caps v9+): a named sequence of up to CS_MAX_MACRO_STEPS steps,
  // fired by CS_NOUN_MACRO or the FIRE chip here. Sibling of CsGroupsPanel --
  // same fw dirty flag; save/discard live in the CHANGES panel.
  import { untrack } from 'svelte';
  import Panel from '@/components/chrome/Panel.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import CsSlotCard from './CsSlotCard.svelte';
  import NumField from '@/components/chrome/NumField.svelte';
  import CsTargetRow from './CsTargetRow.svelte';
  import CsValueStepRow from './CsValueStepRow.svelte';
  import * as Runtime from '@/runtime';
  import * as Domain from '@/domain';
  import { csStatusFromByte } from '@/protocol';
  import { getSession } from '@/components/sessionContext';
  import * as CsField from '@/domain/cs/fieldHelpers';
  import * as CsMacroDraft from '@/domain/cs/macroDraft';
  import * as SlotOps from './csSlotOps';
  import type { MacroDraft, StepDraft } from '@/domain/cs/macroDraft';

  // `visible`: only the page on screen holds the poll interest.
  const { detailTarget = null, visible }: { detailTarget?: HTMLElement | null; visible: boolean } = $props();

  const s = getSession();
  const snap = $derived(s.mirror.current);
  const cs = $derived(s.controlSurfaces);
  const caps = $derived(s.controlSurfaces.caps);

  const drafts = s.drafts.of<MacroDraft>('macros');
  let applying = $state(false);
  function setApplying(busy: boolean): void { applying = busy; }

  const maxSlots = $derived(Math.min(caps?.maxMacros ?? 0, Domain.CS_MAX_MACROS));
  const maxSteps = $derived(Math.min(caps?.maxMacroSteps ?? 0, Domain.CS_MAX_MACRO_STEPS));
  const visibleSlots = $derived(
    Array.from({ length: maxSlots }, (_, i) => i)
      .filter((i) => cs.macros[i] != null || drafts.draftOf(i) != null),
  );
  const allUsed = $derived(visibleSlots.length >= maxSlots);

  // openSlot === -1 means "collapse all"; null means "no preference yet"
  // (first render). expanded falls back to the first visible slot whenever
  // openSlot points nowhere valid, so exactly one slot is open once any exist.
  let openSlot = $state<number | null>(null);
  const expanded = $derived(
    openSlot === -1 ? null : (openSlot != null && visibleSlots.includes(openSlot) ? openSlot : (visibleSlots[0] ?? null)),
  );
  function toggleSlot(i: number): void {
    openSlot = expanded === i ? -1 : i;
  }

  // While a macro runs, the ext-status cadence (poll.ts) keeps the pill and
  // step hint tracking the sequencer; this panel holds its interest.
  $effect(() => (visible ? untrack(() => Runtime.wantCsExtPoll(s)) : undefined));

  function draftOf(i: number): MacroDraft {
    return drafts.draftOf(i) ?? CsMacroDraft.macroDraftFromLive(cs.macros[i]!, cs.nouns);
  }

  function editDraft(i: number, fn: (d: MacroDraft) => void): void {
    const d = drafts.draftOf(i) ?? CsMacroDraft.macroDraftFromLive(cs.macros[i]!, cs.nouns);
    fn(d);
    drafts.editDraft(i, d);
  }

  function editStep(i: number, k: number, fn: (d: StepDraft) => void): void {
    editDraft(i, (d) => { fn(d.steps[k]); });
  }

  function isRunning(i: number): boolean { return cs.extStatus?.macroRunning === i; }

  function isDirty(i: number): boolean {
    const live = cs.macros[i];
    if (!live) return true;                        // NEW: never applied
    const d = drafts.draftOf(i);
    if (!d) return false;
    return !CsMacroDraft.macrosEqual(CsMacroDraft.buildMacro(d, cs.nouns), live);
  }

  function pill(i: number): { text: string; cls: string } {
    const live = cs.macros[i];
    if (!live) return { text: 'NEW', cls: 'new' };
    if (isRunning(i)) return { text: 'RUNNING', cls: 'run' };
    return (cs.extStatus?.macroStatus[i] ?? 0) === 0 ? { text: 'OK', cls: 'ok' } : { text: 'INVALID', cls: 'warn' };
  }

  function invalidHint(i: number): string {
    const r = csStatusFromByte(cs.extStatus?.macroStatus[i] ?? 0);
    const msg = r.ok ? 'Failed to apply the macro.' : r.message;
    return `${msg} Fix that step, then apply.`;
  }

  function addMacro(): void {
    const i = SlotOps.firstFreeSlot(maxSlots, (n) => cs.macros[n] != null || drafts.draftOf(n) != null);
    if (i == null) return;
    drafts.editDraft(i, { name: '', steps: [] });
    openSlot = i;
  }

  // Detached (noveau column) mode: steps collapse to summary rows, one open
  // at a time. Keyed by slot so it never leaks across macros; unset or stale
  // falls back to the last step.
  const detached = $derived(detailTarget != null);
  let stepOpen = $state<{ slot: number; k: number } | null>(null);
  $effect(() => {
    void expanded;
    stepOpen = null;
  });
  function openStepOf(i: number, count: number): number {
    return stepOpen && stepOpen.slot === i && stepOpen.k < count ? stepOpen.k : count - 1;
  }

  function addStep(i: number): void {
    editDraft(i, (d) => { d.steps.push(CsMacroDraft.defaultStepDraft(cs.nouns)); });
    stepOpen = { slot: i, k: draftOf(i).steps.length - 1 };
  }

  function removeStep(i: number, k: number): void {
    editDraft(i, (d) => { d.steps.splice(k, 1); });
    stepOpen = null;
  }

  function targetLabelOf(d: StepDraft): string {
    if (!CsField.showTargetOf(cs.nouns, d.noun)) return '—';
    if (d.grouped) {
      const opts = CsField.groupsAvailable(caps) ? CsField.groupOptionsFor(cs.nouns, d.noun, cs.groups) : [];
      return opts.find((o) => o.v === d.target)?.label ?? `Group ${d.target + 1}`;
    }
    const opts = snap ? CsField.targetOptionsFor(cs.nouns, d.noun, snap.channels) : [];
    return opts.find((o) => o.v === d.target)?.label ?? '—';
  }

  // An empty step list never applies: on a new slot it would write the
  // all-zero macro and the card would silently vanish (same guard as the
  // GROUPS panel's empty member mask).
  function canApply(i: number): boolean {
    const d = drafts.draftOf(i);
    if (!d || !isDirty(i) || d.steps.length === 0) return false;
    return Domain.validateCsMacro(CsMacroDraft.buildMacro(d, cs.nouns), cs.nouns, cs.groups) === 0;
  }

  async function apply(i: number): Promise<void> {
    const d = drafts.draftOf(i);
    if (!d) return;
    await SlotOps.applySlot(i, drafts, setApplying, () => Runtime.applyCsMacro(s, i, CsMacroDraft.buildMacro(d, cs.nouns)));
  }

  function revert(i: number): void {
    drafts.revert(i);
  }

  async function remove(i: number): Promise<void> {
    await SlotOps.removeSlot(i, cs.macros[i] != null, drafts, setApplying, () => Runtime.clearCsMacro(s, i));
  }

  async function fire(i: number): Promise<void> {
    await SlotOps.whileBusy(setApplying, () => Runtime.fireCsMacro(s, i));
  }

  async function cancel(): Promise<void> {
    await SlotOps.whileBusy(setApplying, () => Runtime.cancelCsMacro(s));
  }

  $effect(() => {
    for (const i of drafts.keys()) {
      const dirty = isDirty(i);
      untrack(() => drafts.setDirty(i, dirty));
    }
  });

  function nounOptions(): number[] { return CsMacroDraft.stepNounOptions(cs.nouns); }
  function actionOptions(noun: number): Domain.CsAction[] { return CsMacroDraft.stepActionOptions(cs.nouns, noun); }
</script>

<Panel title="MACROS">
  {#if visibleSlots.length === 0}
    <div class="hint pad empty">
      No macros. A macro fires a short sequence of changes from one button —
      switch input and load a preset, or run a timed mute.
    </div>
  {/if}

  {#each visibleSlots as i (i)}
    {@const d = draftOf(i)}
    {@const p = pill(i)}
    {@const dirty = isDirty(i)}
    {@const live = cs.macros[i]}
    {@const running = isRunning(i)}
    {@const open = expanded === i}
    <CsSlotCard title={`MACRO ${i + 1}`} name={d.name}
      nameLabel={`Name for macro ${i + 1}`} removeLabel={`Remove macro ${i + 1}`}
      pill={p} {dirty} {open} {detailTarget} disabled={applying}
      onToggle={() => toggleSlot(i)}
      onRename={(v) => editDraft(i, (dr) => { dr.name = v; })}
      onRemove={() => remove(i)}>
      {#snippet actions()}
        {#if running}
          <button type="button" class="chip hi" disabled={applying} onclick={cancel}>CANCEL</button>
        {:else}
          <button type="button" class="chip accent"
            disabled={applying || !live || live.stepCount === 0 || dirty}
            title={dirty ? 'Apply the changes first — FIRE runs the applied version' : undefined}
            onclick={() => fire(i)}>FIRE</button>
        {/if}
      {/snippet}
      {#snippet note()}
        {#if running && live}
          <div class="hint srow">Running step {(cs.extStatus?.macroStep ?? 0) + 1} of {live.stepCount}</div>
        {/if}
      {/snippet}
      {#if p.cls === 'warn'}
        <div class="hint err srow">{invalidHint(i)}</div>
      {/if}

      <div class="rows" class:detached>
        {#each d.steps as step, k (k)}
          {@const isOpen = !detached || openStepOf(i, d.steps.length) === k}
          {@const stepActions = actionOptions(step.noun)}
          <div class="step" class:collapsed={!isOpen}>
            {#if detached}
              <div class="sum">
                <button type="button" class="sumbtn" aria-expanded={isOpen}
                  aria-label={`Step ${k + 1}`}
                  onclick={() => { stepOpen = { slot: i, k: isOpen ? -1 : k }; }}>
                  <span class="sn">{k + 1}</span>
                  <span class="sl">{Domain.csNounLabel(step.noun)}</span>
                  <span class="sl">{Domain.csActionLabel(step.action as Domain.CsAction, CsField.enumOf(cs.nouns, step.noun))}</span>
                  <span class="sv">{targetLabelOf(step)}</span>
                  <span class="chev" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                </button>
                <button type="button" class="x-btn" aria-label={`Remove step ${k + 1}`}
                  disabled={applying} onclick={() => removeStep(i, k)}>✕</button>
              </div>
            {/if}
            {#if isOpen}
            <div class="row">
              <span class="microlbl">STEP {k + 1}</span>
              <span class="microlbl">AFTER</span>
              <NumField value={step.preDelay} min={0} max={655.35} step={0.01} kind="s" precision={2}
                ariaLabel={`Delay before step ${k + 1} (s)`} title="Wait this long before the step runs" disabled={applying}
                onChange={(v) => editStep(i, k, (dr) => { dr.preDelay = v; })} />
              {#if !detached}
                <span class="spacer"></span>
                <button type="button" class="x-btn" aria-label={`Remove step ${k + 1}`}
                  disabled={applying} onclick={() => removeStep(i, k)}>✕</button>
              {/if}
            </div>

            <div class="row">
              <span class="microlbl">CONTROLS</span>
              <select class="sel" value={String(step.noun)} aria-label={`Controlled function for step ${k + 1}`} disabled={applying}
                onchange={(e) => {
                  const n = Number((e.currentTarget as HTMLSelectElement).value);
                  editStep(i, k, (dr) => {
                    dr.noun = n; dr.target = 0; dr.index = 0; dr.grouped = false;
                    const legal = actionOptions(n);
                    if (!legal.includes(dr.action as Domain.CsAction)) dr.action = CsMacroDraft.defaultStepAction(cs.nouns, n);
                    CsMacroDraft.defaultStepOperands(dr, cs.nouns);
                  });
                }}>
                {#each nounOptions() as n (n)}
                  <option value={String(n)}>{Domain.csNounLabel(n)}</option>
                {/each}
              </select>
              {#if stepActions.length > 1}
                <span class="microlbl">ACTION</span>
                <select class="sel" value={String(step.action)} aria-label={`Action for step ${k + 1}`} disabled={applying}
                  onchange={(e) => {
                    const a = Number((e.currentTarget as HTMLSelectElement).value);
                    editStep(i, k, (dr) => { dr.action = a; CsMacroDraft.defaultStepOperands(dr, cs.nouns); });
                  }}>
                  {#each stepActions as a (a)}
                    <option value={String(a)}>{Domain.csActionLabel(a, CsField.enumOf(cs.nouns, step.noun))}</option>
                  {/each}
                </select>
              {/if}
            </div>

            {#if CsField.showTargetOf(cs.nouns, step.noun)}
              <div class="row">
                <CsTargetRow nouns={cs.nouns} noun={step.noun} target={step.target} index={step.index} grouped={step.grouped}
                  channels={snap?.channels ?? []} groups={cs.groups} groupsEnabled={CsField.groupsAvailable(caps)}
                  disabled={applying} ariaSuffix={` for step ${k + 1}`}
                  onTarget={(pick) => editStep(i, k, (dr) => { dr.grouped = pick.grouped; dr.target = pick.target; dr.index = 0; })}
                  onBand={(v) => editStep(i, k, (dr) => { dr.index = v; })} />
              </div>
            {/if}

            {#if CsField.showValueOf(step.action) || CsField.showStepOf(step.action, CsMacroDraft.MACRO_STEPPY)}
              <div class="row">
                <CsValueStepRow nouns={cs.nouns} noun={step.noun} action={step.action} steppy={CsMacroDraft.MACRO_STEPPY} presetNames={s.presets.names} macros={cs.macros} displayPages={cs.displayPages}
                  value={step.value} step={step.step} disabled={applying} ariaSuffix={` for step ${k + 1}`}
                  onValue={(v) => editStep(i, k, (dr) => { dr.value = v; })}
                  onStep={(v) => editStep(i, k, (dr) => { dr.step = v; })} />
              </div>
            {/if}

            {#if CsField.showWrapOf(cs.nouns, step.noun, step.action, CsMacroDraft.MACRO_STEPPY)}
              <div class="row">
                <span class="microlbl">WRAP AROUND</span>
                <ToggleSwitch checked={step.wrap} disabled={applying}
                  ariaLabel={`Wrap around for step ${k + 1}`} onChange={(v) => editStep(i, k, (dr) => { dr.wrap = v; })} />
              </div>
            {/if}
            {/if}
          </div>
        {/each}

        <div class="row">
          <button type="button" class="chip" disabled={applying || d.steps.length >= maxSteps} onclick={() => addStep(i)}>ADD STEP</button>
          {#if d.steps.length === 0}
            <span class="hint">Add at least one step</span>
          {:else if d.steps.length >= maxSteps}
            <span class="hint">All {maxSteps} steps are in use.</span>
          {/if}
        </div>

        <div class="row">
          <button type="button" class="chip accent" onclick={() => apply(i)}
            disabled={applying || !canApply(i)}>APPLY</button>
          <button type="button" class="chip hi" onclick={() => revert(i)}
            disabled={applying || !live || !dirty}>REVERT</button>
        </div>
      </div>
    </CsSlotCard>
  {/each}

  <div class="addrow">
    <button type="button" class="chip" disabled={applying || allUsed} onclick={addMacro}>ADD MACRO</button>
    {#if allUsed}
      <span class="hint">All {maxSlots} macro slots are in use.</span>
    {/if}
  </div>
</Panel>

<style>
  .spacer { flex: 1; }
  .rows { padding: 6px 14px 10px; display: flex; flex-direction: column; gap: 8px; }
  .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .srow { padding: 4px 14px 0; }
  .step {
    padding: 6px 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .step + .step { border-top: 1px solid var(--wash); }
  .rows.detached { gap: 0; padding-top: 4px; }
  .rows.detached .step { padding: 0; gap: 6px; }
  .rows.detached .step:not(.collapsed) { padding-bottom: 8px; }
  .rows.detached > .row { padding-top: 8px; }
  .sum { display: flex; align-items: center; gap: 6px; height: var(--h-row); }
  .sumbtn {
    flex: 1;
    min-width: 0;
    height: var(--h-row);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 4px;
    background: none;
    border: none;
    border-radius: var(--radius-s);
    color: var(--text);
    cursor: pointer;
    text-align: left;
  }
  .sumbtn:hover { background: var(--wash); }
  .sumbtn[aria-expanded='true'] { background: var(--wash); }
  .sn { font-family: var(--font-mono); font-size: 12px; color: var(--text-faint); width: 14px; flex: none; }
  .sl { font-size: 11px; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto; min-width: 0; }
  .sv { font-family: var(--font-mono); font-size: 12px; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chev { flex: none; font-size: 10px; color: var(--text-faint); }
  .addrow { display: flex; align-items: center; gap: 10px; padding: 10px 14px 12px; }
  .empty { text-align: center; padding-top: 14px; }
  .pad { padding: 10px 14px; }
</style>
