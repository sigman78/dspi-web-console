import { describe, it, expect } from 'vitest';
import {
  MASTER_VOLUME_STEPS,
  MASTER_VOLUME_MAX_POS,
  masterDbToPos,
  posToMasterDb,
  formatMasterDb,
} from './masterVolumeTaper';

describe('masterVolumeTaper — pos <-> db', () => {
  it('every position round-trips through db back to itself', () => {
    for (let pos = 0; pos <= MASTER_VOLUME_MAX_POS; pos++) {
      const db = posToMasterDb(pos);
      expect(masterDbToPos(db)).toBe(pos);
    }
  });

  it('table is strictly monotonically increasing', () => {
    for (let pos = 1; pos <= MASTER_VOLUME_MAX_POS; pos++) {
      expect(MASTER_VOLUME_STEPS[pos]).toBeGreaterThan(MASTER_VOLUME_STEPS[pos - 1]);
    }
  });

  it('position 0 is the mute sentinel, top position is unity', () => {
    expect(posToMasterDb(0)).toBe(-128);
    expect(posToMasterDb(MASTER_VOLUME_MAX_POS)).toBe(0);
  });

  it('posToMasterDb clamps out-of-range indices', () => {
    expect(posToMasterDb(-5)).toBe(posToMasterDb(0));
    expect(posToMasterDb(MASTER_VOLUME_MAX_POS + 5)).toBe(posToMasterDb(MASTER_VOLUME_MAX_POS));
  });
});

describe('masterVolumeTaper — nearest-position mapping for off-grid db', () => {
  it('picks the nearest table entry, not a floor or ceiling', () => {
    // -33.2 sits between -34 and -33 (1 dB steps); nearest is -33.
    expect(posToMasterDb(masterDbToPos(-33.2))).toBe(-33);
    // -0.24 sits between -0.5 and 0 (0.5 dB steps); nearest is 0.
    expect(posToMasterDb(masterDbToPos(-0.24))).toBe(0);
  });

  it('clamps values beyond the table to the endpoints', () => {
    expect(masterDbToPos(-127.9)).toBe(0);
    expect(masterDbToPos(5)).toBe(MASTER_VOLUME_MAX_POS);
    expect(masterDbToPos(-Infinity)).toBe(0);
    expect(masterDbToPos(Infinity)).toBe(MASTER_VOLUME_MAX_POS);
  });
});

describe('masterVolumeTaper — formatMasterDb', () => {
  it('shows the mute glyph at and below the -127.5 threshold', () => {
    expect(formatMasterDb(-128)).toBe('−∞');
    expect(formatMasterDb(-127.5)).toBe('−∞');
  });

  it('shows a one-decimal dB value above the threshold', () => {
    expect(formatMasterDb(-127.4)).toBe('-127.4');
    expect(formatMasterDb(-6)).toBe('-6.0');
    expect(formatMasterDb(0)).toBe('0.0');
  });
});
