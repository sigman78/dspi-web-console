// EQ link groups: channels whose EQ edits are mirrored while the group is
// locked. Console-only; firmware has no notion of them.

import { groupIntoPairs, groupInputSlotPairs, inputIndexOf, type ChannelId } from './channels';
import { AudioInputSource } from './deviceSections';
import type { FilterParams } from './filter';
import type { ChannelModel, DspSnapshot } from './snapshot';
import { DIFF_TOLERANCE, filterParamsEqual, neq } from './snapshotDiff';

export type EqLinkGroup = readonly ChannelId[];

export function eqLinkGroupKey(group: EqLinkGroup): string {
  return group.join('+');
}

// Output L/R pairs always; input slot pairs only where the source carries a
// true stereo pair (a 2-channel upmix input keeps its derived busses unpaired).
export function defaultEqLinkGroups(
  channels: readonly ChannelModel[],
  source: AudioInputSource,
  activeInputs: number | null,
): EqLinkGroup[] {
  const outputs = groupIntoPairs(channels.filter((c) => c.isOutput))
    .filter((g) => g.members.length === 2)
    .map((g) => g.members.map((c) => c.id));

  const live = activeInputs ?? channels.filter((c) => !c.isOutput).length;
  let inputs = groupInputSlotPairs(channels.filter((c) => !c.isOutput))
    .filter((g) => g.members.length === 2)
    .map((g) => g.members.map((c) => c.id));
  if (source === AudioInputSource.Usb) {
    inputs = live === 2 ? inputs.slice(0, 1) : [];
  } else {
    const limit = Math.max(2, live);
    inputs = inputs.filter((g) => (inputIndexOf(g[0]) ?? Infinity) < limit);
  }
  return [...outputs, ...inputs];
}

export function eqLinkGroupOf(groups: readonly EqLinkGroup[], id: ChannelId): EqLinkGroup | null {
  return groups.find((g) => g.includes(id)) ?? null;
}

function bandsDiffer(a: readonly FilterParams[], b: readonly FilterParams[]): boolean {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (!filterParamsEqual(a[i], b[i], { bypass: true })) return true;
  }
  return false;
}

export function eqLinkDiverged(snapshot: DspSnapshot, group: EqLinkGroup): boolean {
  const [first, ...rest] = group;
  const ref = snapshot.channels.find((c) => c.id === first);
  const refOut = snapshot.outputs.find((o) => o.id === first);
  const refSlot = inputIndexOf(first);
  for (const id of rest) {
    const ch = snapshot.channels.find((c) => c.id === id);
    if (ref && ch && (bandsDiffer(ref.filters, ch.filters) || bandsDiffer(ref.xoverBands, ch.xoverBands))) return true;

    const out = snapshot.outputs.find((o) => o.id === id);
    if (refOut && out && (neq(refOut.gainDb, out.gainDb, DIFF_TOLERANCE.db) || neq(refOut.delayMs, out.delayMs, DIFF_TOLERANCE.ms))) return true;

    const slot = inputIndexOf(id);
    if (refSlot !== null && slot !== null) {
      const a = snapshot.inputPreampDb[refSlot];
      const b = snapshot.inputPreampDb[slot];
      if (a !== undefined && b !== undefined && neq(a, b, DIFF_TOLERANCE.db)) return true;
    }
  }
  return false;
}
