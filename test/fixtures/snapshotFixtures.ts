// Codec-backed snapshot fixture: cannot drift from the model, carries every
// codec invariant. Mutate at the wire level; for domain-level tweaks mutate
// the returned snapshot (it is a plain object).
import { makeBulkObject, type MakeBulkOpts } from './bulkFixtures';
import { buildBulkParams, parseBulkParams, type BulkParams } from '@/protocol';
import { fromBulkParams } from '@/protocol/snapshotCodec';
import { createHardwareProfile, PlatformType, type DspSnapshot, type HardwareProfile } from '@/domain';

export function makeSnapshot(
  mutate?: (b: BulkParams) => void,
  hw: HardwareProfile = createHardwareProfile(PlatformType.RP2350),
  opts: MakeBulkOpts = {},
): DspSnapshot {
  const bulk = makeBulkObject({}, opts);
  mutate?.(bulk);
  return fromBulkParams(hw, parseBulkParams(buildBulkParams(bulk)));
}
