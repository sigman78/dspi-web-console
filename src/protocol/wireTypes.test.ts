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
    expect(Wire.bulkSizeForVersion(12)).toBe(2960);
    expect(Wire.bulkSizeForVersion(16)).toBe(5864);
    expect(Wire.bulkSizeForVersion(17)).toBe(5872);
    expect(Wire.bulkSizeForVersion(18)).toBe(5876);
    expect(Wire.bulkSizeForVersion(99)).toBe(5876);
    expect(Wire.bulkSizeForVersion(5)).toBe(2896);
  });

  it('CsBinding encodes the spec worked examples byte-for-byte and round-trips', () => {
    // Encoder GP27/28 -> master volume, 1 dB/detent (spec 8.2a).
    const encoder = {
      type: 4, noun: 1, action: 1, flags: 0, gpio0: 27, gpio1: 28,
      event: 0, target: 0, index: 0,
      value: 0, step: 256, rangeMin: 0, rangeMax: 0,
    };
    const encoderBytes = Uint8Array.from([
      0x04, 0x01, 0x01, 0x00, 0x1B, 0x1C, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    expect(Codec.encode(Wire.CsBinding, encoder)).toEqual(encoderBytes);
    expect(Codec.decode(Wire.CsBinding, encoderBytes)).toEqual(encoder);

    // LED GP20 indicating loudness on (spec 8.2b).
    const led = {
      type: 5, noun: 3, action: 8, flags: 0, gpio0: 20, gpio1: 0xFF,
      event: 0, target: 0, index: 0,
      value: 1, step: 0, rangeMin: 0, rangeMax: 0,
    };
    const ledBytes = Uint8Array.from([
      0x05, 0x03, 0x08, 0x00, 0x14, 0xFF, 0x00, 0x00, 0x00, 0x00,
      0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    expect(Codec.encode(Wire.CsBinding, led)).toEqual(ledBytes);
    expect(Codec.decode(Wire.CsBinding, ledBytes)).toEqual(led);

    // Clear-slot binding is 24 zero bytes.
    const clear = {
      type: 0, noun: 0, action: 0, flags: 0, gpio0: 0, gpio1: 0,
      event: 0, target: 0, index: 0,
      value: 0, step: 0, rangeMin: 0, rangeMax: 0,
    };
    expect(Codec.encode(Wire.CsBinding, clear)).toEqual(new Uint8Array(24));
  });

  it('CsBinding round-trips negative q8.8 fields as signed int16', () => {
    const b = {
      type: 3, noun: 0, action: 0, flags: 0x02, gpio0: 26, gpio1: 0xFF,
      event: 0, target: 0, index: 0,
      value: 0, step: 0, rangeMin: -7680, rangeMax: -128,   // −30 dB .. −0.5 dB
    };
    const back = Codec.decode(Wire.CsBinding, Codec.encode(Wire.CsBinding, b));
    expect(back.rangeMin).toBe(-7680);
    expect(back.rangeMax).toBe(-128);
  });

  it('CS caps/status codecs decode a synthesized wire image at the documented offsets', () => {
    expect(Codec.sizeOf(Wire.CsCapsPrefix)).toBe(4);
    expect(Codec.sizeOf(Wire.CsNounDesc)).toBe(12);
    expect(Codec.sizeOf(Wire.CsStatusPacket)).toBe(32);
    expect(Codec.sizeOf(Wire.CsCapsBody(8))).toBe(36);   // 8 types * 4 + 4-byte v3 tail

    // MASTER_VOLUME noun descriptor: continuous, −127..0 dB, mask 0x002F.
    const nounBytes = Uint8Array.from([
      0x00, 0x00, 0x2F, 0x00, 0x00, 0x81, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
    ]);
    const noun = Codec.decode(Wire.CsNounDesc, nounBytes);
    expect(noun).toEqual({
      kind: 0, enumCount: 0, actions: 0x002F, minQ8: -32512, maxQ8: 0,
      unit: 1, targetKind: 0, targetCount: 0, dflags: 0,
    });

    const status = Codec.decode(Wire.CsStatusPacket, Uint8Array.from([
      0x16, 0x03, 0x10, 0x01, 0x05, 0x00,
      0x00, 0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0x00, 0x00,
      0, 0, 0, 0, 0, 0, 0, 0,
    ]));
    expect(status.lastStatus).toBe(0x16);
    expect(status.lastSlot).toBe(3);
    expect(status.dirty).toBe(true);
    expect(status.activeMask).toBe(0b101);
    expect(status.slotStatus[1]).toBe(0x02);
    expect(status.irActiveMask).toBe(0);
    expect(status.irCmdStatus).toHaveLength(8);
  });

  it('a caps-v2 (no v3 tail) GetCsCaps body decodes with maxIrCommands 0 via decodePadded', () => {
    const shortBody = Codec.encode(Wire.CsTypeDesc, { actions: 0x0002, pinCount: 2, pinClass: 0 });
    const body = Codec.decodePadded(Wire.CsCapsBody(1), shortBody);
    expect(body.types).toEqual([{ actions: 0x0002, pinCount: 2, pinClass: 0 }]);
    expect(body.maxIrCommands).toBe(0);
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

  it('InputConfig round-trips the multi-SPDIF fields at bytes 8-10', () => {
    const bytes = Codec.encode(Wire.InputConfig, {
      inputSource: 1, spdifRxPin: 5, i2sRxPin: 0, i2sInputRate: 1, i2sInputChannels: 0,
      i2sRxPinExt: [0, 0, 0],
      spdifRxPinExt: [16, 17],
      spdifRxEnabledExtP1: 2, // mask+1 -> mask 1 (SPDIF2 enabled)
    });
    expect(bytes[8]).toBe(16);
    expect(bytes[9]).toBe(17);
    expect(bytes[10]).toBe(2);
    const back = Codec.decode(Wire.InputConfig, bytes);
    expect(back.spdifRxPinExt).toEqual([16, 17]);
    expect(back.spdifRxEnabledExtP1).toBe(2);
  });

  it('GetSpdifInputConfig (0xEF) decodes [count, enableMask, pin0, pin1, pin2]', () => {
    expect(Codec.sizeOf(Wire.SpdifInputConfig)).toBe(5);
    const bytes = Uint8Array.from([3, 0b011, 5, 16, 17]);
    const cfg = Codec.decode(Wire.SpdifInputConfig, bytes);
    expect(cfg).toEqual({ count: 3, enableMask: 0b011, pins: [5, 16, 17] });
  });

});
