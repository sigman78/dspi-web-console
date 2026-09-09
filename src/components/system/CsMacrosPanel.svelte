<script lang="ts">
  // Macros (caps v9+): a named sequence of up to CS_MAX_MACRO_STEPS steps,
  // fired by CS_NOUN_MACRO or the FIRE chip here. Sibling of CsGroupsPanel --
  // same fw dirty flag; save/discard live in the CHANGES panel. No parent of
  // its own so it watches cs.revertEpoch instead of a reset prop.
  import { untrack } from 'svelte';
  import Panel from '@/components/chrome/Panel.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import { connection } from '@/state';
  import {
    applyCsMacro, clearCsMacro, fireCsMacro, cancelCsMacro, refreshCsExtStatus,
  } from '@/runtime';
  import * as Domain from '@/domain';
  import { csStatusFromByte } from '@/protocol';
  import { getSession } from '@/components/sessionContext';
  import * as CsUnit from './csUnitDisplay';
  import * as CsField from './csFieldHelpers';
  import * as CsMacroDraft from './csMacroDraft';
  import type { MacroDraft, StepDraft } from './csMacroDraft';

  const s = getSession();
  const connected = $derived(connection.connected);
  const snap = $derived(s.mirror.current);
  const cs = $derived(s.controlSurfaces);
  const caps = $derived(s.controlSurfaces.caps);
  const busy = $derived(!connected);

  const drafts = $state<Record<number, MacroDraft>>({});
  let applying = $state(false);

  const maxSlots = $derived(Math.min(caps?.maxMacros ?? 0, Domain.CS_MAX_MACROS));
  const maxSteps = $derived(Math.min(caps?.maxMacroSteps ?? 0, Domain.CS_MAX_MACRO_STEPS));
  const visibleSlots = $derived(
    Array.from({ length: maxSlots }, (_, i) => i)
      .filter((i) => cs.macros[i] != null || drafts[i] != null),
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

  $effect(() => {
    void cs.revertEpoch;   // the ONLY dependency -- cleanup must not track drafts
    untrack(() => {
      for (const k of Object.keys(drafts)) delete drafts[Number(k)];
    });
  });

  // Running-macro poll: while a macro is running, re-read ext status every
  // 500 ms so the pill/step hint track the sequencer. A timeout chain (next
  // tick armed only after the previous read settles) so reads never stack
  // behind a slow queue. fireCsMacro already refreshes once, so a zero-delay
  // macro that finished never starts this.
  const anyRunning = $derived(cs.extStatus?.macroRunning != null);
  $effect(() => {
    if (busy || !anyRunning) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async (): Promise<void> => {
      await refreshCsExtStatus(s);
      if (!stopped) timer = setTimeout(() => { void tick(); }, 500);
    };
    timer = setTimeout(() => { void tick(); }, 500);
    return () => { stopped = true; if (timer != null) clearTimeout(timer); };
  });

  function draftOf(i: number): MacroDraft {
    return drafts[i] ?? CsMacroDraft.macroDraftFromLive(cs.macros[i]!, cs.nouns);
  }

  function editDraft(i: number, fn: (d: MacroDraft) => void): void {
    const d = drafts[i] ?? CsMacroDraft.macroDraftFromLive(cs.macros[i]!, cs.nouns);
    fn(d);
    drafts[i] = d;
  }

  function editStep(i: number, k: number, fn: (d: StepDraft) => void): void {
    editDraft(i, (d) => { fn(d.steps[k]); });
  }

  function isRunning(i: number): boolean { return cs.extStatus?.macroRunning === i; }

  function isDirty(i: number): boolean {
    const live = cs.macros[i];
    if (!live) return true;                        // NEW: never applied
    const d = drafts[i];
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

  function firstFreeSlot(): number | null {
    for (let i = 0; i < maxSlots; i++) if (!cs.macros[i] && !drafts[i]) return i;
    return null;
  }

  function addMacro(): void {
    const i = firstFreeSlot();
    if (i == null) return;
    drafts[i] = { name: '', steps: [] };
    openSlot = i;
  }

  function addStep(i: number): void {
    editDraft(i, (d) => { d.steps.push(CsMacroDraft.defaultStepDraft(cs.nouns)); });
  }

  function removeStep(i: number, k: number): void {
    editDraft(i, (d) => { d.steps.splice(k, 1); });
  }

  // An empty step list never applies: on a new slot it would write the
  // all-zero macro and the card would silently vanish (same guard as the
  // GROUPS panel's empty member mask).
  function canApply(i: number): boolean {
    const d = drafts[i];
    if (!d || !isDirty(i) || d.steps.length === 0) return false;
    return Domain.validateCsMacro(CsMacroDraft.buildMacro(d, cs.nouns), cs.nouns, cs.groups) === 0;
  }

  async function apply(i: number): Promise<void> {
    const d = drafts[i];
    if (!d) return;
    applying = true;
    try {
      if (await applyCsMacro(s, i, CsMacroDraft.buildMacro(d, cs.nouns))) delete drafts[i];
    } finally {
      applying = false;
    }
  }

  function revert(i: number): void {
    delete drafts[i];
  }

  async function remove(i: number): Promise<void> {
    if (!cs.macros[i]) { delete drafts[i]; return; }
    applying = true;
    try {
      if (await clearCsMacro(s, i)) delete drafts[i];
    } finally {
      applying = false;
    }
  }

  async function fire(i: number): Promise<void> {
    applying = true;
    try { await fireCsMacro(s, i); } finally { applying = false; }
  }

  async function cancel(): Promise<void> {
    applying = true;
    try { await cancelCsMacro(s); } finally { applying = false; }
  }

  const stagedCount = $derived(visibleSlots.filter((i) => isDirty(i)).length);
  $effect(() => { s.controlSurfaces.staged.macros = stagedCount; });

  function nounOptions(): number[] { return CsMacroDraft.stepNounOptions(cs.nouns); }
  function actionOptions(noun: number): Domain.CsAction[] { return CsMacroDraft.stepActionOptions(cs.nouns, noun); }

  function groupOptionsFor(d: StepDraft): { v: number; label: string }[] {
    return CsField.groupsAvailable(caps) ? CsField.groupOptionsFor(cs.nouns, d.noun, cs.groups) : [];
  }
  function groupBandOptionsFor(d: StepDraft): { v: number; label: string }[] {
    const g = cs.groups[d.target];
    return snap && g ? CsField.groupBandOptionsFor(cs.nouns, d.noun, g, snap.channels) : [];
  }

  function num(e: Event): number | null {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    return Number.isNaN(v) ? null : v;
  }
</script>

<Panel code="CT.04" title="MACROS">
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
    <div class="slot" class:open>
      <div class="slothead" onclick={(e) => { if (!open && !(e.target as HTMLElement).closest('button, input')) toggleSlot(i); }}>
        <button type="button" class="hdrbtn" aria-expanded={open} onclick={() => toggleSlot(i)}>
          <span class="chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
          <span class="stitle" class:staged={dirty}
            title={dirty ? 'Unapplied changes — APPLY to preview them live' : undefined}
            >MACRO {i + 1}</span>
          {#if !open}
            <span class="nametext" class:faint={!d.name}>{d.name || 'Unnamed'}</span>
          {/if}
        </button>
        {#if open}
          <input class="nameinput" type="text" maxlength="31" placeholder="Unnamed"
            value={d.name} aria-label={`Name for macro ${i + 1}`}
            disabled={busy || applying}
            onchange={(e) => editDraft(i, (dr) => { dr.name = (e.currentTarget as HTMLInputElement).value; })} />
        {/if}
        <span class="pill {p.cls}">{p.text}</span>
        <span class="spacer"></span>
        {#if running}
          <button type="button" class="chip hi" disabled={busy || applying} onclick={cancel}>CANCEL</button>
        {:else}
          <button type="button" class="chip accent"
            disabled={busy || applying || !live || live.stepCount === 0 || dirty}
            title={dirty ? 'Apply the changes first — FIRE runs the applied version' : undefined}
            onclick={() => fire(i)}>FIRE</button>
        {/if}
        <button type="button" class="x" aria-label={`Remove macro ${i + 1}`}
          disabled={applying} onclick={() => remove(i)}>✕</button>
      </div>

      {#if running && live}
        <div class="hint srow">Running step {(cs.extStatus?.macroStep ?? 0) + 1} of {live.stepCount}</div>
      {/if}

      {#if open}
      {#if p.cls === 'warn'}
        <div class="hint err srow">{invalidHint(i)}</div>
      {/if}

      <div class="rows">
        {#each d.steps as step, k (k)}
          {@const actions = actionOptions(step.noun)}
          {@const showGroup = CsField.groupsAvailable(caps) && CsField.showTargetOf(cs.nouns, step.noun)}
          {@const groupOpts = groupOptionsFor(step)}
          {@const missingGroup = showGroup && step.grouped && !groupOpts.some((o) => o.v === step.target)}
          <div class="step">
            <div class="row">
              <span class="microlbl">STEP {k + 1}</span>
              <span class="microlbl">AFTER</span>
              <input class="numfield" type="number" step="0.01" min="0" max="655.35"
                value={step.preDelay} aria-label={`Delay before step ${k + 1} (s)`}
                title="Wait this long before the step runs" disabled={busy || applying}
                onchange={(e) => { const v = num(e); if (v != null) editStep(i, k, (dr) => { dr.preDelay = v; }); }} />
              <span class="hint">s</span>
              <span class="spacer"></span>
              <button type="button" class="x" aria-label={`Remove step ${k + 1}`}
                disabled={applying} onclick={() => removeStep(i, k)}>✕</button>
            </div>

            <div class="row">
              <span class="microlbl">CONTROLS</span>
              <select class="sel" value={String(step.noun)} aria-label={`Controlled function for step ${k + 1}`} disabled={busy || applying}
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
              {#if actions.length > 1}
                <span class="microlbl">ACTION</span>
                <select class="sel" value={String(step.action)} aria-label={`Action for step ${k + 1}`} disabled={busy || applying}
                  onchange={(e) => {
                    const a = Number((e.currentTarget as HTMLSelectElement).value);
                    editStep(i, k, (dr) => { dr.action = a; CsMacroDraft.defaultStepOperands(dr, cs.nouns); });
                  }}>
                  {#each actions as a (a)}
                    <option value={String(a)}>{Domain.csActionLabel(a, CsField.enumOf(cs.nouns, step.noun))}</option>
                  {/each}
                </select>
              {/if}
            </div>

            {#if CsField.showTargetOf(cs.nouns, step.noun)}
              <div class="row">
                <span class="microlbl">
                  {CsField.targetKindOf(cs.nouns, step.noun) === Domain.CS_TARGET_INPUT_CH ? 'INPUT'
                    : CsField.targetKindOf(cs.nouns, step.noun) === Domain.CS_TARGET_OUTPUT_CH ? 'OUTPUT' : 'CHANNEL'}
                </span>
                <select class="sel" value={step.grouped ? `g${step.target}` : String(step.target)} aria-label={`Target channel for step ${k + 1}`} disabled={busy || applying}
                  onchange={(e) => {
                    const v = (e.currentTarget as HTMLSelectElement).value;
                    editStep(i, k, (dr) => {
                      if (v.startsWith('g')) { dr.grouped = true; dr.target = Number(v.slice(1)); }
                      else { dr.grouped = false; dr.target = Number(v); }
                      dr.index = 0;
                    });
                  }}>
                  {#if showGroup && (groupOpts.length > 0 || missingGroup)}
                    <optgroup label="CHANNELS">
                      {#each (snap ? CsField.targetOptionsFor(cs.nouns, step.noun, snap.channels) : []) as o (o.v)}
                        <option value={String(o.v)}>{o.label}</option>
                      {/each}
                    </optgroup>
                    <optgroup label="GROUPS">
                      {#each groupOpts as o (o.v)}
                        <option value={`g${o.v}`}>{o.label}</option>
                      {/each}
                      {#if missingGroup}
                        <option value={`g${step.target}`} disabled>Group {step.target + 1} (missing)</option>
                      {/if}
                    </optgroup>
                  {:else}
                    {#each (snap ? CsField.targetOptionsFor(cs.nouns, step.noun, snap.channels) : []) as o (o.v)}
                      <option value={String(o.v)}>{o.label}</option>
                    {/each}
                  {/if}
                </select>
                {#if CsField.showBandOf(cs.nouns, step.noun)}
                  <span class="microlbl">BAND</span>
                  <select class="sel" value={String(step.index)} aria-label={`Filter band for step ${k + 1}`} disabled={busy || applying}
                    onchange={(e) => { const v = Number((e.currentTarget as HTMLSelectElement).value); editStep(i, k, (dr) => { dr.index = v; }); }}>
                    {#each (step.grouped ? groupBandOptionsFor(step) : (snap ? CsField.bandOptionsFor(step.noun, step.target, snap.channels) : [])) as o (o.v)}
                      <option value={String(o.v)}>{o.label}</option>
                    {/each}
                  </select>
                {/if}
              </div>
            {/if}

            {#if CsField.showValueOf(step.action) || CsField.showStepOf(step.action, CsMacroDraft.MACRO_STEPPY)}
              <div class="row">
                {#if CsField.showValueOf(step.action)}
                  <span class="microlbl">{CsField.valueLabel(step.action, CsField.contOf(cs.nouns, step.noun), step.noun)}</span>
                  {#if CsField.contOf(cs.nouns, step.noun)}
                    <input class="numfield" type="number" step="0.5"
                      min={cs.nouns[step.noun] ? CsUnit.valueToDisplay(CsField.unitOf(cs.nouns, step.noun), cs.nouns[step.noun].minQ8) : 0}
                      max={cs.nouns[step.noun] ? CsUnit.valueToDisplay(CsField.unitOf(cs.nouns, step.noun), cs.nouns[step.noun].maxQ8) : 0}
                      value={step.value} aria-label={`Value for step ${k + 1}`} disabled={busy || applying}
                      onchange={(e) => { const v = num(e); if (v != null) editStep(i, k, (dr) => { dr.value = v; }); }} />
                    <span class="hint">{CsUnit.unitSuffix(CsField.unitOf(cs.nouns, step.noun))}</span>
                  {:else}
                    <select class="sel" value={String(step.value)} aria-label={`Value for step ${k + 1}`} disabled={busy || applying}
                      onchange={(e) => { const v = Number((e.currentTarget as HTMLSelectElement).value); editStep(i, k, (dr) => { dr.value = v; }); }}>
                      {#each (CsField.enumOf(cs.nouns, step.noun) ? CsField.enumValueOptions(cs.nouns, step.noun, s.presets.names, cs.macros) : CsField.boolValueOptions(step.noun)) as o (o.v)}
                        <option value={String(o.v)}>{o.label}</option>
                      {/each}
                    </select>
                  {/if}
                {/if}
                {#if CsField.showStepOf(step.action, CsMacroDraft.MACRO_STEPPY)}
                  <span class="microlbl">STEP SIZE</span>
                  {#if CsField.enumOf(cs.nouns, step.noun)}
                    <input class="numfield" type="number" step="1" min="1"
                      max={Math.max(1, (cs.nouns[step.noun]?.enumCount ?? 2) - 1)}
                      value={step.step} aria-label={`Step size (positions) for step ${k + 1}`} disabled={busy || applying}
                      onchange={(e) => { const v = num(e); if (v != null) editStep(i, k, (dr) => { dr.step = v; }); }} />
                  {:else}
                    <input class="numfield" type="number" step={CsUnit.isLogStep(CsField.unitOf(cs.nouns, step.noun)) ? '0.01' : '0.5'} min="0"
                      value={step.step} aria-label={`Step size for step ${k + 1}`} disabled={busy || applying}
                      onchange={(e) => { const v = num(e); if (v != null) editStep(i, k, (dr) => { dr.step = v; }); }} />
                    <span class="hint">{CsUnit.stepUnitSuffix(CsField.unitOf(cs.nouns, step.noun))}</span>
                  {/if}
                {/if}
              </div>
            {/if}

            {#if CsField.showWrapOf(cs.nouns, step.noun, step.action, CsMacroDraft.MACRO_STEPPY)}
              <div class="row">
                <span class="microlbl">WRAP AROUND</span>
                <ToggleSwitch size="sm" checked={step.wrap} disabled={busy || applying}
                  ariaLabel={`Wrap around for step ${k + 1}`} onChange={(v) => editStep(i, k, (dr) => { dr.wrap = v; })} />
              </div>
            {/if}
          </div>
        {/each}

        <div class="row">
          <button type="button" class="chip" disabled={busy || applying || d.steps.length >= maxSteps} onclick={() => addStep(i)}>ADD STEP</button>
          {#if d.steps.length === 0}
            <span class="hint">Add at least one step</span>
          {:else if d.steps.length >= maxSteps}
            <span class="hint">All {maxSteps} steps are in use.</span>
          {/if}
        </div>

        <div class="row">
          <button type="button" class="chip accent" onclick={() => apply(i)}
            disabled={busy || applying || !canApply(i)}>APPLY</button>
          <button type="button" class="chip hi" onclick={() => revert(i)}
            disabled={applying || !live || !dirty}>REVERT</button>
        </div>
      </div>
      {/if}
    </div>
  {/each}

  <div class="addrow">
    <button type="button" class="chip" disabled={busy || applying || allUsed} onclick={addMacro}>ADD MACRO</button>
    {#if allUsed}
      <span class="hint">All {maxSlots} macro slots are in use.</span>
    {/if}
  </div>
</Panel>

<style>
  .slot { border-bottom: 1px solid var(--wash); }
  .slot.open {
    background: color-mix(in oklab, var(--accent) 6%, transparent);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .slothead {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px 0;
    font-family: var(--font-mono);
  }
  .slot:not(.open) .slothead { padding-bottom: 8px; cursor: pointer; }
  .slot:not(.open):hover { background: var(--wash-faint); }
  .slot.open .slothead {
    padding-bottom: 6px;
    border-bottom: 1px solid color-mix(in oklab, var(--accent) 25%, transparent);
    margin-bottom: 4px;
  }
  .hdrbtn {
    display: flex;
    align-items: center;
    gap: 8px;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: inherit;
    font: inherit;
    text-align: left;
    min-width: 0;
  }
  .hdrbtn:hover .stitle { color: var(--text); }
  .chev { font-size: 9px; color: var(--text-faint); width: 8px; }
  .slot.open .chev { color: var(--accent); }
  .stitle {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1.2px;
    color: var(--text-dim);
  }
  .slot.open .stitle { color: var(--text); }
  .nametext {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 160px;
  }
  .nametext.faint { color: var(--text-faint); }
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
  .pill.run  { color: var(--accent); border-color: color-mix(in oklab, var(--accent) 50%, transparent); }
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
  .step {
    padding: 6px 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .step + .step { border-top: 1px solid var(--wash); }
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
  .addrow { display: flex; align-items: center; gap: 10px; padding: 10px 14px 12px; }
  .empty { text-align: center; padding-top: 14px; }
  .pad { padding: 10px 14px; }
</style>
