import { groupInputSlotPairs, groupIntoPairs, inputIndexOf, type ChannelId } from './channels';
import { defaultEqLinkGroups, eqLinkGroupOf } from './eqLink';
import type { DspSnapshot } from './snapshot';

export interface MeterSlot {
  id: ChannelId;
  name: string;
  /** Slots sharing a group index are drawn as a pair. */
  group: number;
  /** Side tag ("L"/"R") when the pair's names match, else the full name. */
  label: string;
  /** Shared name prefix, set on both members of a matched pair. */
  groupLabel: string | null;
}

interface Member {
  id: ChannelId;
  name: string;
}

function toSlots(groups: readonly (readonly Member[])[]): MeterSlot[] {
  const slots: MeterSlot[] = [];
  groups.forEach((members, group) => {
    const pair = members.length === 2 ? pairLabel(members[0].name, members[1].name) : null;
    members.forEach((m, i) => {
      slots.push({
        id: m.id,
        name: m.name,
        group,
        label: pair ? (i === 0 ? pair.a : pair.b) : m.name,
        groupLabel: pair ? pair.group : null,
      });
    });
  });
  return slots;
}

// Enabled outputs in L/R pairs, PDM alone. Pairs are formed on the full list
// first, so a lone enabled side stays single instead of pairing with an
// unrelated neighbour.
export function meterOutputs(snapshot: DspSnapshot): MeterSlot[] {
  const groups = groupIntoPairs(snapshot.channels.filter((c) => c.isOutput))
    .map((g) => g.members.filter((c) => snapshot.outputs.some((o) => o.id === c.id && o.enabled)))
    .filter((members) => members.length > 0);
  return toSlots(groups);
}

// Live inputs, paired exactly where the EQ link rules pair them. An unknown
// live count shows two slots, but pairing follows the app's EQ link groups.
export function meterInputs(snapshot: DspSnapshot, activeInputs: number | null): MeterSlot[] {
  const limit = Math.max(2, activeInputs ?? 2);
  const inputs = snapshot.channels.filter((c) => {
    if (c.isOutput) return false;
    const slot = inputIndexOf(c.id);
    return slot !== null && slot < limit;
  });
  const linked = defaultEqLinkGroups(snapshot.channels, snapshot.inputConfig.source, activeInputs);
  const groups: Member[][] = [];
  for (const g of groupInputSlotPairs(inputs)) {
    if (g.members.length === 2 && eqLinkGroupOf(linked, g.members[0].id) !== null) {
      groups.push(g.members);
    } else {
      for (const c of g.members) groups.push([c]);
    }
  }
  return toSlots(groups);
}

export function sameMeterSlots(a: readonly MeterSlot[], b: readonly MeterSlot[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.id !== y.id || x.label !== y.label || x.groupLabel !== y.groupLabel || x.group !== y.group) return false;
  }
  return true;
}

const SIDE = /^(.*\S)\s+(left|right|l|r)$/i;

// Two names that differ only by a trailing L/R token share a pair label.
export function pairLabel(a: string, b: string): { group: string; a: string; b: string } | null {
  const ma = SIDE.exec(a.trim());
  const mb = SIDE.exec(b.trim());
  if (!ma || !mb || ma[1] !== mb[1]) return null;
  const sa = ma[2][0].toUpperCase();
  const sb = mb[2][0].toUpperCase();
  if (sa === sb) return null;
  return { group: ma[1], a: sa, b: sb };
}
