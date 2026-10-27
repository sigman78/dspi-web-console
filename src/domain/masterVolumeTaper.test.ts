import { describe, it, expect } from 'vitest';
import * as MasterVolumeTaper from './masterVolumeTaper';

describe('masterVolumeTaper — pos <-> db', () => {
  it('every position round-trips through db back to itself', () => {
    for (let pos = 0; pos <= MasterVolumeTaper.MASTER_VOLUME_MAX_POS; pos++) {
      const db = MasterVolumeTaper.posToMasterDb(pos);
      expect(MasterVolumeTaper.masterDbToPos(db)).toBe(pos);
    }
  });

  it('table is strictly monotonically increasing', () => {
    for (let pos = 1; pos <= MasterVolumeTaper.MASTER_VOLUME_MAX_POS; pos++) {
      expect(MasterVolumeTaper.MASTER_VOLUME_STEPS[pos]).toBeGreaterThan(MasterVolumeTaper.MASTER_VOLUME_STEPS[pos - 1]);
    }
  });

  it('position 0 is the mute sentinel, top position is unity', () => {
    expect(MasterVolumeTaper.posToMasterDb(0)).toBe(-128);
    expect(MasterVolumeTaper.posToMasterDb(MasterVolumeTaper.MASTER_VOLUME_MAX_POS)).toBe(0);
  });

  it('posToMasterDb clamps out-of-range indices', () => {
    expect(MasterVolumeTaper.posToMasterDb(-5)).toBe(MasterVolumeTaper.posToMasterDb(0));
    expect(MasterVolumeTaper.posToMasterDb(MasterVolumeTaper.MASTER_VOLUME_MAX_POS + 5)).toBe(MasterVolumeTaper.posToMasterDb(MasterVolumeTaper.MASTER_VOLUME_MAX_POS));
  });
});

describe('masterVolumeTaper — nearest-position mapping for off-grid db', () => {
  it('picks the nearest table entry, not a floor or ceiling', () => {
    // -33.2 sits between -34 and -33 (1 dB steps); nearest is -33.
    expect(MasterVolumeTaper.posToMasterDb(MasterVolumeTaper.masterDbToPos(-33.2))).toBe(-33);
    // -0.24 sits between -0.5 and 0 (0.5 dB steps); nearest is 0.
    expect(MasterVolumeTaper.posToMasterDb(MasterVolumeTaper.masterDbToPos(-0.24))).toBe(0);
  });

  it('clamps values beyond the table to the endpoints', () => {
    expect(MasterVolumeTaper.masterDbToPos(-127.9)).toBe(0);
    expect(MasterVolumeTaper.masterDbToPos(5)).toBe(MasterVolumeTaper.MASTER_VOLUME_MAX_POS);
    expect(MasterVolumeTaper.masterDbToPos(-Infinity)).toBe(0);
    expect(MasterVolumeTaper.masterDbToPos(Infinity)).toBe(MasterVolumeTaper.MASTER_VOLUME_MAX_POS);
  });
});
