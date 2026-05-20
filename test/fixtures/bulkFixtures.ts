// Test fixture helper for bulk-param packets. Replaces the loose
// synthesizeBulkParams pattern. Defaults seed via defaultBulkParams,
// callers spread overrides for the field(s) they care about.

import { buildBulkParams, defaultBulkParams, type BulkParams } from '@/protocol/bulkParser';

export interface MakeBulkOpts {
  platformId?: number;
  numCh?: number;
  numOut?: number;
}

// Build a wire-format bulk packet from partial BulkParams overrides.
// Default platform is RP2350 (11 ch, 9 out) — most existing tests
// were synthesized against this shape.
export function makeBulk(overrides: Partial<BulkParams> = {}, opts: MakeBulkOpts = {}): Uint8Array {
  const base = defaultBulkParams({
    platformId: opts.platformId ?? 1,
    numCh:      opts.numCh      ?? 11,
    numOut:     opts.numOut     ?? 9,
  });
  return buildBulkParams({ ...base, ...overrides });
}

// Same shape as makeBulk but returns the BulkParams object before
// serialisation — useful for tests that want to assert on the
// pre-wire shape or pass it to fromBulkParams directly.
export function makeBulkObject(overrides: Partial<BulkParams> = {}, opts: MakeBulkOpts = {}): BulkParams {
  const base = defaultBulkParams({
    platformId: opts.platformId ?? 1,
    numCh:      opts.numCh      ?? 11,
    numOut:     opts.numOut     ?? 9,
  });
  return { ...base, ...overrides };
}
