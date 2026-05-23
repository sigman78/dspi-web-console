import { describe, it, expect } from 'vitest';
import { CONTROL_POLICY } from './controlPolicy';

describe('CONTROL_POLICY', () => {
  // The convergence rule (granular⇒resync, bulk⇒self) is a design invariant the
  // type system does not enforce; the outbox relies on it when routing writes.
  it('every entry is internally consistent (granular=>resync, bulk=>self)', () => {
    for (const [, p] of Object.entries(CONTROL_POLICY)) {
      if (p.strategy === 'granular') expect(p.converge).toBe('resync');
      else expect(p.converge).toBe('self');
    }
  });
});
