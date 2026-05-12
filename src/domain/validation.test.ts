import { describe, it, test, expect } from 'vitest';
import {
  MASTER_VOLUME_MAX_DB,
  MASTER_VOLUME_MIN_DB,
  validateMasterVolumeDb,
  validateBandFrequency,
  validateBandQ,
  validateBandGain,
  validateInputPreampDb,
  validateOutputGainDb,
  validateOutputDelayMs,
  validateCrosspointGainDb,
} from './validation';

describe('validateMasterVolumeDb', () => {
  it('accepts values inside [min, max]', () => {
    expect(validateMasterVolumeDb(MASTER_VOLUME_MIN_DB).ok).toBe(true);
    expect(validateMasterVolumeDb(MASTER_VOLUME_MAX_DB).ok).toBe(true);
    expect(validateMasterVolumeDb(-12).ok).toBe(true);
  });

  it('rejects below min', () => {
    const r = validateMasterVolumeDb(MASTER_VOLUME_MIN_DB - 0.1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/below/);
  });

  it('rejects above max', () => {
    const r = validateMasterVolumeDb(MASTER_VOLUME_MAX_DB + 0.1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/above/);
  });

  it('rejects NaN and infinities', () => {
    expect(validateMasterVolumeDb(NaN).ok).toBe(false);
    expect(validateMasterVolumeDb(Infinity).ok).toBe(false);
    expect(validateMasterVolumeDb(-Infinity).ok).toBe(false);
  });
});

describe('band validators', () => {
  it('rejects frequency below 20 Hz', () => {
    expect(validateBandFrequency(10).ok).toBe(false);
  });
  it('accepts 1 kHz', () => {
    expect(validateBandFrequency(1000).ok).toBe(true);
  });
  it('rejects Q above 24', () => {
    expect(validateBandQ(30).ok).toBe(false);
  });
  it('rejects band gain above +24 dB', () => {
    expect(validateBandGain(25).ok).toBe(false);
  });
});

describe('input preamp validator', () => {
  it('accepts -60 to +10 dB', () => {
    expect(validateInputPreampDb(0).ok).toBe(true);
    expect(validateInputPreampDb(-60).ok).toBe(true);
    expect(validateInputPreampDb(10).ok).toBe(true);
  });
  it('rejects -61 dB', () => {
    expect(validateInputPreampDb(-61).ok).toBe(false);
  });
});

describe('output gain/delay validators', () => {
  it('accepts -60 to +12 dB output gain', () => {
    expect(validateOutputGainDb(0).ok).toBe(true);
    expect(validateOutputGainDb(13).ok).toBe(false);
  });
  it('rejects negative delay', () => {
    expect(validateOutputDelayMs(-1).ok).toBe(false);
  });
  it('accepts 50 ms delay', () => {
    expect(validateOutputDelayMs(50).ok).toBe(true);
  });
  it('accepts 170 ms delay (matches MatrixHeader slider max)', () => {
    expect(validateOutputDelayMs(170).ok).toBe(true);
  });
  it('rejects 171 ms delay', () => {
    expect(validateOutputDelayMs(171).ok).toBe(false);
  });
});

describe('crosspoint gain validator', () => {
  it('accepts -60 to +12 dB', () => {
    expect(validateCrosspointGainDb(0).ok).toBe(true);
  });
  it('rejects NaN', () => {
    expect(validateCrosspointGainDb(NaN).ok).toBe(false);
  });
});

import {
  validateLoudnessRefSpl, validateLoudnessIntensityPct,
  validateCrossfeedPreset, validateCrossfeedFreq, validateCrossfeedFeedDb,
  validateLevellerSpeed, validateLevellerAmount, validateLevellerMaxGainDb, validateLevellerGateDb,
} from './validation';

describe('processing module validators', () => {
  describe('loudness', () => {
    test('refSpl accepts 40..100', () => {
      expect(validateLoudnessRefSpl(40).ok).toBe(true);
      expect(validateLoudnessRefSpl(85).ok).toBe(true);
      expect(validateLoudnessRefSpl(100).ok).toBe(true);
    });
    test('refSpl rejects out-of-range', () => {
      expect(validateLoudnessRefSpl(39).ok).toBe(false);
      expect(validateLoudnessRefSpl(101).ok).toBe(false);
      expect(validateLoudnessRefSpl(NaN).ok).toBe(false);
      expect(validateLoudnessRefSpl(Infinity).ok).toBe(false);
    });
    test('intensityPct accepts 0..200 (percent; wire stores the percent value directly)', () => {
      expect(validateLoudnessIntensityPct(0).ok).toBe(true);
      expect(validateLoudnessIntensityPct(100).ok).toBe(true);
      expect(validateLoudnessIntensityPct(200).ok).toBe(true);
    });
    test('intensityPct rejects out-of-range', () => {
      expect(validateLoudnessIntensityPct(-0.01).ok).toBe(false);
      expect(validateLoudnessIntensityPct(200.01).ok).toBe(false);
    });
  });

  describe('crossfeed', () => {
    test('preset accepts integers 0..3', () => {
      expect(validateCrossfeedPreset(0).ok).toBe(true);
      expect(validateCrossfeedPreset(1).ok).toBe(true);
      expect(validateCrossfeedPreset(2).ok).toBe(true);
      expect(validateCrossfeedPreset(3).ok).toBe(true);
    });
    test('preset rejects non-integer or out-of-range', () => {
      expect(validateCrossfeedPreset(-1).ok).toBe(false);
      expect(validateCrossfeedPreset(4).ok).toBe(false);
      expect(validateCrossfeedPreset(1.5).ok).toBe(false);
    });
    test('freq accepts 500..2000', () => {
      expect(validateCrossfeedFreq(500).ok).toBe(true);
      expect(validateCrossfeedFreq(1200).ok).toBe(true);
      expect(validateCrossfeedFreq(2000).ok).toBe(true);
    });
    test('freq rejects out-of-range', () => {
      expect(validateCrossfeedFreq(499).ok).toBe(false);
      expect(validateCrossfeedFreq(2001).ok).toBe(false);
    });
    test('feedDb accepts 0..15', () => {
      expect(validateCrossfeedFeedDb(0).ok).toBe(true);
      expect(validateCrossfeedFeedDb(7.5).ok).toBe(true);
      expect(validateCrossfeedFeedDb(15).ok).toBe(true);
    });
    test('feedDb rejects out-of-range', () => {
      expect(validateCrossfeedFeedDb(-0.1).ok).toBe(false);
      expect(validateCrossfeedFeedDb(15.1).ok).toBe(false);
    });
  });

  describe('leveller', () => {
    test('speed accepts integers 0..2', () => {
      expect(validateLevellerSpeed(0).ok).toBe(true);
      expect(validateLevellerSpeed(1).ok).toBe(true);
      expect(validateLevellerSpeed(2).ok).toBe(true);
    });
    test('speed rejects non-integer or out-of-range', () => {
      expect(validateLevellerSpeed(-1).ok).toBe(false);
      expect(validateLevellerSpeed(3).ok).toBe(false);
      expect(validateLevellerSpeed(1.5).ok).toBe(false);
    });
    test('amount accepts 0..100', () => {
      expect(validateLevellerAmount(0).ok).toBe(true);
      expect(validateLevellerAmount(50).ok).toBe(true);
      expect(validateLevellerAmount(100).ok).toBe(true);
    });
    test('amount rejects out-of-range', () => {
      expect(validateLevellerAmount(-1).ok).toBe(false);
      expect(validateLevellerAmount(101).ok).toBe(false);
    });
    test('maxGainDb accepts 0..35', () => {
      expect(validateLevellerMaxGainDb(0).ok).toBe(true);
      expect(validateLevellerMaxGainDb(20).ok).toBe(true);
      expect(validateLevellerMaxGainDb(35).ok).toBe(true);
    });
    test('maxGainDb rejects out-of-range', () => {
      expect(validateLevellerMaxGainDb(-1).ok).toBe(false);
      expect(validateLevellerMaxGainDb(36).ok).toBe(false);
    });
    test('gateDb accepts -96..0', () => {
      expect(validateLevellerGateDb(-96).ok).toBe(true);
      expect(validateLevellerGateDb(-40).ok).toBe(true);
      expect(validateLevellerGateDb(0).ok).toBe(true);
    });
    test('gateDb rejects out-of-range', () => {
      expect(validateLevellerGateDb(-96.1).ok).toBe(false);
      expect(validateLevellerGateDb(0.1).ok).toBe(false);
    });
  });
});
