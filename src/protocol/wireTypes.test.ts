import { describe, it, expect } from 'vitest';
import { Codec } from '@/utils';
import * as Wire from './wireTypes';

describe('wireTypes — V7–V10 tail codecs', () => {
  it('each new tail section is exactly 16 bytes', () => {
    expect(Codec.sizeOf(Wire.InputConfig)).toBe(16);
    expect(Codec.sizeOf(Wire.LgSoundSync)).toBe(16);
    expect(Codec.sizeOf(Wire.UserVolume)).toBe(16);
    expect(Codec.sizeOf(Wire.DacHwMute)).toBe(16);
  });

  it('BulkSizes climb by 16 per version to 2960 at V10', () => {
    expect(Wire.BulkSizes.V6Full).toBe(2896);
    expect(Wire.BulkSizes.V7).toBe(2912);
    expect(Wire.BulkSizes.V8).toBe(2928);
    expect(Wire.BulkSizes.V9).toBe(2944);
    expect(Wire.BulkSizes.V10).toBe(2960);
  });

  it('bulkLayout gates each tail section on version AND payloadLength', () => {
    const v6 = Wire.bulkLayout({ formatVersion: 6, payloadLength: 2896 });
    expect(v6.inputSource).toBe(false);
    expect(v6.lgSoundSync).toBe(false);
    expect(v6.userVolume).toBe(false);
    expect(v6.dacHwMute).toBe(false);

    // Exactly V7: only the first new section is present.
    const v7 = Wire.bulkLayout({ formatVersion: 7, payloadLength: 2912 });
    expect(v7.inputSource).toBe(true);
    expect(v7.lgSoundSync).toBe(false);

    const v10 = Wire.bulkLayout({ formatVersion: 10, payloadLength: 2960 });
    expect(v10.inputSource).toBe(true);
    expect(v10.lgSoundSync).toBe(true);
    expect(v10.userVolume).toBe(true);
    expect(v10.dacHwMute).toBe(true);

    const truncated = Wire.bulkLayout({ formatVersion: 10, payloadLength: 2928 });
    expect(truncated.inputSource).toBe(true);
    expect(truncated.lgSoundSync).toBe(true);
    expect(truncated.userVolume).toBe(false);
    expect(truncated.dacHwMute).toBe(false);
  });

  it('BandParams carries a bypass byte at offset 1 and round-trips', () => {
    expect(Codec.sizeOf(Wire.BandParams)).toBe(16);
    const bytes = Codec.encode(Wire.BandParams, {
      type: 1, bypass: 1, frequency: 1000, q: 1, gain: 3,
    });
    expect(bytes[1]).toBe(1);
    const back = Codec.decode(Wire.BandParams, bytes);
    expect(back.bypass).toBe(1);
    expect(back.type).toBe(1);
  });

  it('bulkSizeForVersion maps version to packet size', () => {
    expect(Wire.bulkSizeForVersion(6)).toBe(2896);
    expect(Wire.bulkSizeForVersion(7)).toBe(2912);
    expect(Wire.bulkSizeForVersion(10)).toBe(2960);
    expect(Wire.bulkSizeForVersion(99)).toBe(2960);
    expect(Wire.bulkSizeForVersion(5)).toBe(2896);
  });

  it('SpdifRxStatus is 16 bytes and round-trips its fields', () => {
    expect(Codec.sizeOf(Wire.SpdifRxStatus)).toBe(16);
    const bytes = Codec.encode(Wire.SpdifRxStatus, {
      state: 2, inputSource: 1, lockCount: 3, lossCount: 1,
      sampleRate: 48000, parityErrors: 7, fifoFillPct: 50,
    });
    const back = Codec.decode(Wire.SpdifRxStatus, bytes);
    expect(back).toMatchObject({
      state: 2, inputSource: 1, lockCount: 3, lossCount: 1,
      sampleRate: 48000, parityErrors: 7, fifoFillPct: 50,
    });
  });

});
