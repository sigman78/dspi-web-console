// The TARGET select carries channels and groups in one option space: a plain
// index is a channel, `g<n>` is group n.
import * as Domain from '@/domain';

export interface TargetPick { grouped: boolean; target: number }

export function encodeTarget(grouped: boolean, target: number): string {
  return grouped ? `g${target}` : String(target);
}

export function decodeTarget(value: string): TargetPick {
  return value.startsWith('g')
    ? { grouped: true, target: Number(value.slice(1)) }
    : { grouped: false, target: Number(value) };
}

/**
 * Whether the picker splits into CHANNELS/GROUPS optgroups, and whether the
 * draft points at a group that no longer exists (kept visible, disabled).
 */
export function groupSplit(
  groupsEnabled: boolean, groupOptions: readonly { v: number }[], grouped: boolean, target: number,
): { split: boolean; missing: boolean } {
  const missing = groupsEnabled && grouped && !groupOptions.some((o) => o.v === target);
  return { split: groupsEnabled && (groupOptions.length > 0 || missing), missing };
}

export function targetKindLabel(kind: number): string {
  if (kind === Domain.CS_TARGET_INPUT_CH) return 'INPUT';
  if (kind === Domain.CS_TARGET_OUTPUT_CH) return 'OUTPUT';
  return 'CHANNEL';
}
