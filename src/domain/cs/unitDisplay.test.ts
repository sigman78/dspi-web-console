import { describe, it, expect } from 'vitest';
import * as CsUnit from './unitDisplay';
import * as Domain from '@/domain';

describe('unitDisplay — CS_UNIT_MS (caps v4)', () => {
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

describe('unitDisplay — CS_UNIT_MS_LOG', () => {
  it('keeps value and range as plain integer ms, not 8.8', () => {
    expect(CsUnit.displayToValue(Domain.CS_UNIT_MS_LOG, 250)).toBe(250);
    expect(CsUnit.valueToDisplay(Domain.CS_UNIT_MS_LOG, 1000)).toBe(1000);
    expect(CsUnit.unitSuffix(Domain.CS_UNIT_MS_LOG)).toBe('ms');
  });

  it('steps in octaves like Hz', () => {
    expect(CsUnit.isLogStep(Domain.CS_UNIT_MS_LOG)).toBe(true);
    expect(CsUnit.displayToStep(Domain.CS_UNIT_MS_LOG, 1)).toBe(256);
    expect(CsUnit.stepToDisplay(Domain.CS_UNIT_MS_LOG, 128)).toBe(0.5);
    expect(CsUnit.stepUnitSuffix(Domain.CS_UNIT_MS_LOG)).toBe('octaves');
  });
});
