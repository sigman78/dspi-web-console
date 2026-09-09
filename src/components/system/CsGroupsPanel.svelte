<script lang="ts">
  // Target groups (caps v9+): a named set of channels a binding, IR command,
  // or macro step can address at once via CS_FLAG_GROUP. Sibling of ControlSurfacesPanel,
  // same fw dirty flag; save/discard live in the CHANGES panel. No parent of
  // its own to hand it a reset prop -- it watches cs.revertEpoch instead.
  import { untrack } from 'svelte';
  import Panel from '@/components/chrome/Panel.svelte';
  import MaskChipRow from '@/components/chrome/MaskChipRow.svelte';
  import { connection } from '@/state';
  import { applyCsGroup, clearCsGroup } from '@/runtime';
  import * as Domain from '@/domain';
  import { csStatusFromByte } from '@/protocol';
  import { getSession } from '@/components/sessionContext';
  import * as CsField from './csFieldHelpers';

  const s = getSession();
  const connected = $derived(connection.connected);
  const snap = $derived(s.mirror.current);
  const cs = $derived(s.controlSurfaces);
  const caps = $derived(s.controlSurfaces.caps);
  const busy = $derived(!connected);

  interface GroupDraft { kind: number; mask: number; name: string }
  const drafts = $state<Record<number, GroupDraft>>({});
  let applying = $state(false);

  // The device's ceiling, capped at what the wire (group index 0-7) and
  // validateCsGroupRef can address.
  const maxSlots = $derived(Math.min(caps?.maxGroups ?? 0, Domain.CS_MAX_GROUPS));
  const visibleSlots = $derived(
    Array.from({ length: maxSlots }, (_, i) => i)
      .filter((i) => cs.groups[i] != null || drafts[i] != null),
  );
  const allUsed = $derived(visibleSlots.length >= maxSlots);

  $effect(() => {
    void cs.revertEpoch;   // the ONLY dependency -- cleanup must not track drafts
    untrack(() => {
      for (const k of Object.keys(drafts)) delete drafts[Number(k)];
    });
  });

  function channelCounts(): Domain.CsChannelCounts {
    return snap ? CsField.csChannelCounts(snap.channels) : { inputs: 0, outputs: 0, dsp: 0 };
  }

  function draftFromLive(g: Domain.CsGroup): GroupDraft {
    return { kind: g.targetKind, mask: g.memberMask, name: g.name };
  }

  function draftOf(i: number): GroupDraft {
    return drafts[i] ?? draftFromLive(cs.groups[i]!);
  }

  function editDraft(i: number, fn: (d: GroupDraft) => void): void {
    const d = drafts[i] ?? draftFromLive(cs.groups[i]!);
    fn(d);
    drafts[i] = d;
  }

  function buildGroup(d: GroupDraft): Domain.CsGroup {
    return { targetKind: d.kind, memberMask: d.mask, name: d.name };
  }

  function groupsEqual(a: Domain.CsGroup, b: Domain.CsGroup): boolean {
    return a.targetKind === b.targetKind && a.memberMask === b.memberMask && a.name === b.name;
  }

  function isDirty(i: number): boolean {
    const live = cs.groups[i];
    if (!live) return true;                        // NEW: never applied
    const d = drafts[i];
    if (!d) return false;
    return !groupsEqual(buildGroup(d), live);
  }

  function pill(i: number): { text: string; cls: string } {
    const live = cs.groups[i];
    if (!live) return { text: 'NEW', cls: 'new' };
    return (cs.extStatus?.groupStatus[i] ?? 0) === 0 ? { text: 'OK', cls: 'ok' } : { text: 'INVALID', cls: 'warn' };
  }

  function invalidHint(i: number): string {
    const r = csStatusFromByte(cs.extStatus?.groupStatus[i] ?? 0);
    return r.ok ? 'Failed to apply the group.' : r.message;
  }

  // How many bindings/IR commands and macro steps reference this group --
  // informational only, not a delete guard (fw allows clearing an in-use
  // group; dependents just go INACTIVE / INVALID with INVALID_GROUP).
  function usage(i: number): { controls: number; steps: number } {
    let controls = 0;
    let steps = 0;
    for (const b of cs.bindings) if (b && (b.flags & Domain.CS_FLAG_GROUP) && b.target === i) controls++;
    for (const c of cs.irCommands) if (c && (c.flags & Domain.CS_FLAG_GROUP) && c.target === i) controls++;
    for (const m of cs.macros) {
      if (!m) continue;
      for (let k = 0; k < m.stepCount; k++) {
        const st = m.steps[k];
        if ((st.flags & Domain.CS_FLAG_GROUP) && st.target === i) steps++;
      }
    }
    return { controls, steps };
  }

  function usageText(u: { controls: number; steps: number }): string {
    const parts: string[] = [];
    if (u.controls > 0) parts.push(`${u.controls} control${u.controls === 1 ? '' : 's'}`);
    if (u.steps > 0) parts.push(`${u.steps} macro step${u.steps === 1 ? '' : 's'}`);
    return `Used by ${parts.join(', ')}`;
  }

  function firstFreeSlot(): number | null {
    for (let i = 0; i < maxSlots; i++) if (!cs.groups[i] && !drafts[i]) return i;
    return null;
  }

  function addGroup(): void {
    const i = firstFreeSlot();
    if (i == null) return;
    drafts[i] = { kind: Domain.CS_TARGET_OUTPUT_CH, mask: 0, name: '' };
  }

  function canApply(i: number): boolean {
    const d = drafts[i];
    if (!d || !isDirty(i)) return false;
    return Domain.validateCsGroup(buildGroup(d), channelCounts()) === 0;
  }

  async function apply(i: number): Promise<void> {
    const d = drafts[i];
    if (!d) return;
    applying = true;
    try {
      if (await applyCsGroup(s, i, buildGroup(d))) delete drafts[i];
    } finally {
      applying = false;
    }
  }

  function revert(i: number): void {
    delete drafts[i];
  }

  // Remove = drop a never-applied draft locally; clear a live slot via the
  // all-zero group (dependents go INACTIVE, not refused).
  async function remove(i: number): Promise<void> {
    if (!cs.groups[i]) { delete drafts[i]; return; }
    applying = true;
    try {
      if (await clearCsGroup(s, i)) delete drafts[i];
    } finally {
      applying = false;
    }
  }

  const stagedCount = $derived(visibleSlots.filter((i) => isDirty(i)).length);
  $effect(() => { s.controlSurfaces.staged.groups = stagedCount; });
</script>

<Panel code="CT.03" title="GROUPS">
  {#if visibleSlots.length === 0}
    <div class="hint pad empty">
      No groups. A group lets one control address several channels at once —
      mute a speaker pair, or trim a stereo pair together.
    </div>
  {/if}

  {#each visibleSlots as i (i)}
    {@const d = draftOf(i)}
    {@const p = pill(i)}
    {@const dirty = isDirty(i)}
    {@const u = usage(i)}
    <div class="slot">
      <div class="slothead">
        <span class="stitle" class:staged={dirty}
          title={dirty ? 'Unapplied changes — APPLY to preview them live' : undefined}
          >GROUP {i + 1}</span>
        <input class="nameinput" type="text" maxlength="31" placeholder="Unnamed"
          value={d.name} aria-label={`Name for group ${i + 1}`}
          disabled={busy || applying}
          onchange={(e) => editDraft(i, (dr) => { dr.name = (e.currentTarget as HTMLInputElement).value; })} />
        <span class="pill {p.cls}">{p.text}</span>
        <span class="spacer"></span>
        <button type="button" class="x" aria-label={`Remove group ${i + 1}`}
          disabled={applying} onclick={() => remove(i)}>✕</button>
      </div>

      {#if p.cls === 'warn'}
        <div class="hint err srow">{invalidHint(i)}</div>
      {/if}

      <div class="rows">
        <div class="row">
          <span class="microlbl">KIND</span>
          <select class="sel" value={String(d.kind)} aria-label="Group kind" disabled={busy || applying}
            onchange={(e) => {
              const v = Number((e.currentTarget as HTMLSelectElement).value);
              editDraft(i, (dr) => { dr.kind = v; dr.mask = 0; });
            }}>
            {#each [Domain.CS_TARGET_INPUT_CH, Domain.CS_TARGET_OUTPUT_CH, Domain.CS_TARGET_DSP_CH] as k (k)}
              <option value={String(k)}>{Domain.csGroupKindLabel(k)}</option>
            {/each}
          </select>
        </div>

        <div class="row">
          <MaskChipRow label="MEMBERS" items={snap ? CsField.groupMemberItems(d.kind, snap.channels) : []}
            mask={d.mask} disabled={busy || applying}
            onToggle={(idx) => editDraft(i, (dr) => { dr.mask ^= (1 << idx); })} />
          {#if d.mask === 0}
            <span class="hint">Pick at least one channel</span>
          {/if}
        </div>

        {#if u.controls + u.steps > 0}
          <div class="row">
            <span class="hint">{usageText(u)}</span>
          </div>
        {/if}

        <div class="row">
          <button type="button" class="chip accent" onclick={() => apply(i)}
            disabled={busy || applying || !canApply(i)}>APPLY</button>
          <button type="button" class="chip hi" onclick={() => revert(i)}
            disabled={applying || !cs.groups[i] || !dirty}>REVERT</button>
        </div>
      </div>
    </div>
  {/each}

  <div class="addrow">
    <button type="button" class="chip" disabled={busy || applying || allUsed} onclick={addGroup}>ADD GROUP</button>
    {#if allUsed}
      <span class="hint">All {maxSlots} group slots are in use.</span>
    {/if}
  </div>
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
  .hint.err { color: var(--err); }
  .addrow { display: flex; align-items: center; gap: 10px; padding: 10px 14px 12px; }
  .empty { text-align: center; padding-top: 14px; }
  .pad { padding: 10px 14px; }
</style>
