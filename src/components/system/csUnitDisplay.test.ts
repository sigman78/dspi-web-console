import { describe, it, expect } from 'vitest';
import * as CsUnit from './csUnitDisplay';
import * as Domain from '@/domain';

describe('csUnitDisplay — CS_UNIT_MS (caps v4)', () => {
  // Guards the silent-mis-scale trap: an unlisted unit falls into the
  // plain-integer default branch, off by 256x in both directions.
  it('routes ms through the 8.8 encoding with linear stepping', () => {
    expect(CsUnit.valueToDisplay(Domain.CS_UNIT_MS, Domain.msToQ8(5.5))).toBeCloseTo(5.5);
    expect(CsUnit.displayToValue(Domain.CS_UNIT_MS, 5.5)).toBe(1408);
    expect(CsUnit.isLogStep(Domain.CS_UNIT_MS)).toBe(false);
    expect(CsUnit.unitSuffix(Domain.CS_UNIT_MS)).toBe('ms');
    expect(CsUnit.displayToStep(Domain.CS_UNIT_MS, 0.1)).toBe(26);   // the 0.1 ms default detent
  });
});
