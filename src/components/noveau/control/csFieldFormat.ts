import * as Domain from '@/domain';
import type { ValueKind } from '@/components/chrome/valueFieldFormat';

/** Numeric-field presentation for a noun unit: formatter kind, edit step, decimals. */
export function unitField(unit: number): { kind: ValueKind; step: number; precision: number } {
  switch (unit) {
    case Domain.CS_UNIT_DB:      return { kind: 'dB', step: 0.1, precision: 1 };
    case Domain.CS_UNIT_PERCENT: return { kind: 'pct', step: 0.1, precision: 1 };
    case Domain.CS_UNIT_MS:      return { kind: 'ms', step: 0.1, precision: 1 };
    case Domain.CS_UNIT_MS_LOG:  return { kind: 'ms', step: 1, precision: 0 };
    case Domain.CS_UNIT_Q:       return { kind: 'q', step: 0.01, precision: 2 };
    case Domain.CS_UNIT_HZ:      return { kind: 'hz', step: 1, precision: 0 };
    default:                     return { kind: 'int', step: 1, precision: 0 };
  }
}
