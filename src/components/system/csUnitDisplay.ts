// Unit-aware conversion between the wire's 8.8/plain-int encoding and a
// draft's display units (see domain/controlSurfaces.ts's q8 helpers). Shared
// between the binding editor (ControlSurfacesPanel) and the IR command editor
// (CsIrCommands) -- both edit value/step fields for the same CsNounDesc units.
// Hz is a plain integer on the wire; step on a Hz/Q noun is an 8.8-octave
// size, not the unit itself.
import * as Domain from '@/domain';

export function valueToDisplay(unit: number, q8: number): number {
  switch (unit) {
    case Domain.CS_UNIT_DB:      return Domain.q8ToDb(q8);
    case Domain.CS_UNIT_Q:       return Domain.q8ToQ(q8);
    case Domain.CS_UNIT_PERCENT: return Domain.q8ToPercent(q8);
    default:                     return q8;
  }
}

export function displayToValue(unit: number, display: number): number {
  switch (unit) {
    case Domain.CS_UNIT_DB:      return Domain.dbToQ8(display);
    case Domain.CS_UNIT_Q:       return Domain.qToQ8(display);
    case Domain.CS_UNIT_PERCENT: return Domain.percentToQ8(display);
    default:                     return Math.round(display);
  }
}

export function isLogStep(unit: number): boolean { return unit === Domain.CS_UNIT_HZ || unit === Domain.CS_UNIT_Q; }

export function stepToDisplay(unit: number, q8: number): number {
  return isLogStep(unit) ? Domain.q8StepToOctaves(q8) : valueToDisplay(unit, q8);
}

export function displayToStep(unit: number, display: number): number {
  return isLogStep(unit) ? Domain.octavesToQ8Step(display) : displayToValue(unit, display);
}

export function unitSuffix(unit: number): string {
  switch (unit) {
    case Domain.CS_UNIT_DB:      return 'dB';
    case Domain.CS_UNIT_PERCENT: return '%';
    case Domain.CS_UNIT_HZ:      return 'Hz';
    case Domain.CS_UNIT_Q:       return 'Q';
    default:                     return '';
  }
}

export function stepUnitSuffix(unit: number): string { return isLogStep(unit) ? 'octaves' : unitSuffix(unit); }
