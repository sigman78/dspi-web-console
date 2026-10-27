<script lang="ts">
  // Target groups (caps v9+): a named set of channels a binding, IR command,
  // or macro step can address at once via CS_FLAG_GROUP. Sibling of ControlSurfacesPanel,
  // same fw dirty flag; save/discard live in the CHANGES panel.
  import { untrack } from 'svelte';
  import Panel from '@/components/chrome/Panel.svelte';
  import MaskChips from '@/components/chrome/MaskChips.svelte';
  import CsSlotCard from './CsSlotCard.svelte';
  import { applyCsGroup, clearCsGroup } from '@/runtime';
  import * as Domain from '@/domain';
  import { csStatusFromByte } from '@/protocol';
  import { getSession } from '@/components/sessionContext';
  import * as CsField from '@/domain/cs/fieldHelpers';
  import * as SlotOps from './csSlotOps';

  const { detailTarget = null }: { detailTarget?: HTMLElement | null } = $props();

  const s = getSession();
  const snap = $derived(s.mirror.current);
  const cs = $derived(s.controlSurfaces);
  const caps = $derived(s.controlSurfaces.caps);

  interface GroupDraft { kind: number; mask: number; name: string }
  const drafts = s.drafts.of<GroupDraft>('groups');
  let applying = $state(false);
  function setApplying(busy: boolean): void { applying = busy; }

  // The device's ceiling, capped at what the wire (group index 0-7) and
  // validateCsGroupRef can address.
  const maxSlots = $derived(Math.min(caps?.maxGroups ?? 0, Domain.CS_MAX_GROUPS));
  const visibleSlots = $derived(
    Array.from({ length: maxSlots }, (_, i) => i)
      .filter((i) => cs.groups[i] != null || drafts.draftOf(i) != null),
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

  function channelCounts(): Domain.CsChannelCounts {
    return snap ? CsField.csChannelCounts(snap.channels) : { inputs: 0, outputs: 0, dsp: 0 };
  }

  function draftFromLive(g: Domain.CsGroup): GroupDraft {
    return { kind: g.targetKind, mask: g.memberMask, name: g.name };
  }

  function draftOf(i: number): GroupDraft {
    return drafts.draftOf(i) ?? draftFromLive(cs.groups[i]!);
  }

  function editDraft(i: number, fn: (d: GroupDraft) => void): void {
    const d = drafts.draftOf(i) ?? draftFromLive(cs.groups[i]!);
    fn(d);
    drafts.editDraft(i, d);
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
    const d = drafts.draftOf(i);
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

  function addGroup(): void {
    const i = SlotOps.firstFreeSlot(maxSlots, (n) => cs.groups[n] != null || drafts.draftOf(n) != null);
    if (i == null) return;
    drafts.editDraft(i, { kind: Domain.CS_TARGET_OUTPUT_CH, mask: 0, name: '' });
    openSlot = i;
  }

  function memberCount(mask: number): number {
    let n = 0;
    for (let m = mask; m !== 0; m >>>= 1) n += m & 1;
    return n;
  }

  function canApply(i: number): boolean {
    const d = drafts.draftOf(i);
    if (!d || !isDirty(i)) return false;
    return Domain.validateCsGroup(buildGroup(d), channelCounts()) === 0;
  }

  async function apply(i: number): Promise<void> {
    const d = drafts.draftOf(i);
    if (!d) return;
    await SlotOps.applySlot(i, drafts, setApplying, () => applyCsGroup(s, i, buildGroup(d)));
  }

  function revert(i: number): void {
    drafts.revert(i);
  }

  // Remove = drop a never-applied draft locally; clear a live slot via the
  // all-zero group (dependents go INACTIVE, not refused).
  async function remove(i: number): Promise<void> {
    await SlotOps.removeSlot(i, cs.groups[i] != null, drafts, setApplying, () => clearCsGroup(s, i));
  }

  $effect(() => {
    for (const i of drafts.keys()) {
      const dirty = isDirty(i);
      untrack(() => drafts.setDirty(i, dirty));
    }
  });
</script>

<Panel title="GROUPS">
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
    {@const open = expanded === i}
    {@const n = memberCount(d.mask)}
    <CsSlotCard title={`GROUP ${i + 1}`} name={d.name}
      nameLabel={`Name for group ${i + 1}`} removeLabel={`Remove group ${i + 1}`}
      pill={p} {dirty} {open} {detailTarget} disabled={applying}
      onToggle={() => toggleSlot(i)}
      onRename={(v) => editDraft(i, (dr) => { dr.name = v; })}
      onRemove={() => remove(i)}>
      {#snippet summary()}
        <span class="meta">{Domain.csGroupKindLabel(d.kind)} · {n} member{n === 1 ? '' : 's'}</span>
      {/snippet}
      {#if p.cls === 'warn'}
        <div class="hint err srow">{invalidHint(i)}</div>
      {/if}

      <div class="rows">
        <div class="row">
          <span class="microlbl">KIND</span>
          <select class="sel" value={String(d.kind)} aria-label="Group kind" disabled={applying}
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
          <MaskChips label="MEMBERS" items={snap ? CsField.groupMemberItems(d.kind, snap.channels) : []}
            mask={d.mask} disabled={applying} wrap
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
            disabled={applying || !canApply(i)}>APPLY</button>
          <button type="button" class="chip hi" onclick={() => revert(i)}
            disabled={applying || !cs.groups[i] || !dirty}>REVERT</button>
        </div>
      </div>
    </CsSlotCard>
  {/each}

  <div class="addrow">
    <button type="button" class="chip" disabled={applying || allUsed} onclick={addGroup}>ADD GROUP</button>
    {#if allUsed}
      <span class="hint">All {maxSlots} group slots are in use.</span>
    {/if}
  </div>
</Panel>

<style>
  .meta {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-faint);
  }
  .rows { padding: 6px 14px 10px; display: flex; flex-direction: column; gap: 8px; }
  .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .row :global(.prow) { border-top: none; height: auto; }
  .srow { padding: 4px 14px 0; }
  .addrow { display: flex; align-items: center; gap: 10px; padding: 10px 14px 12px; }
  .empty { text-align: center; padding-top: 14px; }
  .pad { padding: 10px 14px; }
</style>
