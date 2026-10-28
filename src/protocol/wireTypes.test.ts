import { describe, it, expect } from 'vitest';
import { Codec } from '@/utils';
import * as Wire from './wireTypes';

describe('wireTypes — V28 packet layout', () => {
  it('the section codecs sum to the 5944-byte V28 packet; later versions append sections', () => {
    expect(Wire.BULK_SIZE_V28).toBe(5944);
    expect(Wire.bulkSizeForVersion(28)).toBe(5944);
    // V29 subharm (+16), V30 subharm tail (+20), V31 tube (+48), V32 limiter (+108).
    expect(Wire.bulkSizeForVersion(29)).toBe(5960);
    expect(Wire.bulkSizeForVersion(30)).toBe(5980);
    expect(Wire.bulkSizeForVersion(31)).toBe(6028);
    expect(Wire.bulkSizeForVersion(32)).toBe(6136);
    expect(Wire.bulkSizeForVersion(99)).toBe(6136);
  });

  it('bulkLayout gates each trailing section on version AND payloadLength', () => {
    const v28 = Wire.bulkLayout({ formatVersion: 28, payloadLength: Wire.BULK_SIZE_V28 });
    expect(v28).toEqual({ subharm: false, subharmExt: false, tube: false, limiter: false });

    const v30 = Wire.bulkLayout({ formatVersion: 30, payloadLength: Wire.BULK_SIZE_V30 });
    expect(v30).toEqual({ subharm: true, subharmExt: true, tube: false, limiter: false });

    // Header claims V32 but the buffer is cut short: the limiter is not read.
    const truncated = Wire.bulkLayout({ formatVersion: 32, payloadLength: Wire.BULK_SIZE_V31 });
    expect(truncated).toEqual({ subharm: true, subharmExt: true, tube: true, limiter: false });
  });

  it('BandParams carries bypass at byte 1 and the Linkwitz qp sidecar at bytes 2-3', () => {
    expect(Codec.sizeOf(Wire.BandParams)).toBe(16);
    const bytes = Codec.encode(Wire.BandParams, {
      type: 11, bypass: 1, qp: 0x0123, frequency: 1000, q: 1, gain: 3,
    });
    expect(bytes[1]).toBe(1);
    expect(bytes[2]).toBe(0x23);
    expect(bytes[3]).toBe(0x01);
    expect(Codec.decode(Wire.BandParams, bytes)).toMatchObject({ type: 11, bypass: 1, qp: 0x0123 });
  });

  it('CsBinding encodes the spec worked examples byte-for-byte and round-trips', () => {
    // Encoder GP27/28 -> master volume, 1 dB/detent (spec 8.2a).
    const encoder = {
      type: 4, noun: 1, action: 1, flags: 0, gpio0: 27, gpio1: 28,
      event: 0, target: 0, index: 0,
      baseBright: 0, value: 0, step: 256, rangeMin: 0, rangeMax: 0,
      onDelay: 0, offDelay: 0, reserved2: [0, 0],
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
      baseBright: 0, value: 1, step: 0, rangeMin: 0, rangeMax: 0,
      onDelay: 0, offDelay: 0, reserved2: [0, 0],
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
      baseBright: 0, value: 0, step: 0, rangeMin: 0, rangeMax: 0,
      onDelay: 0, offDelay: 0, reserved2: [0, 0],
    };
    expect(Codec.encode(Wire.CsBinding, clear)).toEqual(new Uint8Array(24));

    // Amplifier trigger, LED GP20 above -50 dB with a 600 s off-delay (spec 8.2g).
    const ampTrigger = {
      type: 5, noun: 51, action: 10, flags: 0, gpio0: 20, gpio1: 0xFF,
      event: 0, target: 0, index: 0,
      baseBright: 0, value: -12800, step: 0, rangeMin: 0, rangeMax: 0,
      onDelay: 0, offDelay: 6000, reserved2: [0, 0],
    };
    const ampTriggerBytes = Uint8Array.from([
      0x05, 0x33, 0x0A, 0x00, 0x14, 0xFF, 0x00, 0x00, 0x00, 0x00,
      0x00, 0xCE, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x70, 0x17, 0x00, 0x00,
    ]);
    expect(Codec.encode(Wire.CsBinding, ampTrigger)).toEqual(ampTriggerBytes);
    expect(Codec.decode(Wire.CsBinding, ampTriggerBytes)).toEqual(ampTrigger);

    // LED_PWM: base_bright = 40% ceiling, on_delay = 0.5 s.
    const ledPwm = {
      type: 6, noun: 3, action: 8, flags: 0, gpio0: 21, gpio1: 0xFF,
      event: 0, target: 0, index: 0,
      baseBright: 40, value: 1, step: 0, rangeMin: 0, rangeMax: 0,
      onDelay: 5, offDelay: 0, reserved2: [0, 0],
    };
    const ledPwmBytes = Uint8Array.from([
      0x06, 0x03, 0x08, 0x00, 0x15, 0xFF, 0x00, 0x00, 0x00, 0x28,
      0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x05, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    expect(Codec.encode(Wire.CsBinding, ledPwm)).toEqual(ledPwmBytes);
    expect(Codec.decode(Wire.CsBinding, ledPwmBytes)).toEqual(ledPwm);
  });

  it('CsBinding round-trips negative q8.8 fields as signed int16', () => {
    const b = {
      type: 3, noun: 0, action: 0, flags: 0x02, gpio0: 26, gpio1: 0xFF,
      event: 0, target: 0, index: 0,
      baseBright: 0, value: 0, step: 0, rangeMin: -7680, rangeMax: -128,   // −30 dB .. −0.5 dB
      onDelay: 0, offDelay: 0, reserved2: [0, 0],
    };
    const back = Codec.decode(Wire.CsBinding, Codec.encode(Wire.CsBinding, b));
    expect(back.rangeMin).toBe(-7680);
    expect(back.rangeMax).toBe(-128);
  });

  it('CS caps/status codecs decode a synthesized wire image at the documented offsets', () => {
    expect(Codec.sizeOf(Wire.CsCapsPrefix)).toBe(4);
    expect(Codec.sizeOf(Wire.CsNounDesc)).toBe(12);
    expect(Codec.sizeOf(Wire.CsStatusPacketV3)).toBe(32);
    expect(Codec.sizeOf(Wire.CsStatusPacketV6)).toBe(41);
    expect(Codec.sizeOf(Wire.CsCapsBody(8))).toBe(36);   // 8 types * 4 + 4-byte tail

    // MASTER_VOLUME noun descriptor: continuous, −127..0 dB, mask 0x002F.
    const nounBytes = Uint8Array.from([
      0x00, 0x00, 0x2F, 0x00, 0x00, 0x81, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
    ]);
    const noun = Codec.decode(Wire.CsNounDesc, nounBytes);
    expect(noun).toEqual({
      kind: 0, enumCount: 0, actions: 0x002F, minQ8: -32512, maxQ8: 0,
      unit: 1, targetKind: 0, targetCount: 0, dflags: 0,
    });

    const status = Codec.decode(Wire.CsStatusPacketV3, Uint8Array.from([
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

  it('CsStatusPacketV6 decodes the widened caps-v6+ IR fields at their own offsets', () => {
    const status = Codec.decode(Wire.CsStatusPacketV6, Uint8Array.from([
      0x16, 0x03, 0x10, 0x01, 0x05, 0x00,                              // lastStatus..activeMask (as V3)
      0x00, 0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,             // slotStatus[16]
      0x34, 0x12,                                                      // irActiveMask u16 LE = 0x1234
      0x02,                                                            // irLearnState
      0xAA, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xBB,             // irCmdStatus[16]
    ]));
    expect(status.lastSlot).toBe(3);
    expect(status.activeMask).toBe(0b101);
    expect(status.slotStatus[1]).toBe(0x02);
    expect(status.irActiveMask).toBe(0x1234);
    expect(status.irLearnState).toBe(0x02);
    expect(status.irCmdStatus).toHaveLength(16);
    expect(status.irCmdStatus[0]).toBe(0xAA);
    expect(status.irCmdStatus[15]).toBe(0xBB);
  });

  it('a caps-v2 (no tail) GetCsCaps body decodes with every tail field 0 via decodePadded', () => {
    const shortBody = Codec.encode(Wire.CsTypeDesc, { actions: 0x0002, pinCount: 2, pinClass: 0 });
    const body = Codec.decodePadded(Wire.CsCapsBody(1), shortBody);
    expect(body.types).toEqual([{ actions: 0x0002, pinCount: 2, pinClass: 0 }]);
    expect(body.maxIrCommands).toBe(0);
    expect(body.maxGroups).toBe(0);
    expect(body.maxMacros).toBe(0);
    expect(body.maxMacroSteps).toBe(0);
  });

  it('CsCapsBody carries the caps-v9+ groups/macros/macro-steps tail right after max_ir_commands', () => {
    const bytes = Codec.encode(Wire.CsCapsBody(1), {
      types: [{ actions: 0x0002, pinCount: 2, pinClass: 0 }],
      maxIrCommands: 16, maxGroups: 8, maxMacros: 4, maxMacroSteps: 6,
    });
    expect(bytes.slice(4)).toEqual(Uint8Array.from([16, 8, 4, 6]));
    const back = Codec.decode(Wire.CsCapsBody(1), bytes);
    expect(back).toEqual({
      types: [{ actions: 0x0002, pinCount: 2, pinClass: 0 }],
      maxIrCommands: 16, maxGroups: 8, maxMacros: 4, maxMacroSteps: 6,
    });
  });

  it('CsGroup encodes a named group to the 40-byte image and decodes back (reserved bytes skipped)', () => {
    const group = { targetKind: 2, memberMask: 0x00000005, name: 'Fronts' };
    const bytes = Codec.encode(Wire.CsGroup, group);
    expect(bytes).toEqual(Uint8Array.from([
      0x02, 0x00, 0x00, 0x00, 0x05, 0x00, 0x00, 0x00,
      0x46, 0x72, 0x6F, 0x6E, 0x74, 0x73, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]));
    expect(Codec.decode(Wire.CsGroup, bytes)).toEqual(group);
  });

  it('CsExtStatusPacket decodes a synthesized 24-B image with per-slot status at their own offsets', () => {
    expect(Codec.sizeOf(Wire.CsExtStatusPacket)).toBe(24);
    const bytes = Uint8Array.from([
      8, 8, 8, 0xFF, 0,           // maxGroups, maxMacros, maxMacroSteps, macroRunning, macroStep
      0, 0, 0,                    // reserved
      0, 0x1F, 0, 0, 0, 0, 0, 0,  // groupStatus[0..7]
      0, 0, 0, 0, 0, 0, 0, 0xAA,  // macroStatus[0..7]
    ]);
    const status = Codec.decode(Wire.CsExtStatusPacket, bytes);
    expect(status.macroRunning).toBe(0xFF);
    expect(status.groupStatus[1]).toBe(0x1F);
    expect(status.macroStatus[7]).toBe(0xAA);
  });

  it('CsMacroStep encodes and decodes its 12-byte image', () => {
    const step = { noun: 7, action: 5, flags: 0, target: 0, index: 0, value: 1, step: 0, preDelay: 150 };
    const bytes = Codec.encode(Wire.CsMacroStep, step);
    expect(bytes).toEqual(Uint8Array.from([
      0x07, 0x05, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x96, 0x00,
    ]));
    expect(Codec.decode(Wire.CsMacroStep, bytes)).toEqual(step);
  });

  it('CsMacroHeader encodes name + step count into the 36-byte image with zeroed reserved bytes', () => {
    const bytes = Codec.encode(Wire.CsMacroHeader, { name: 'Night', stepCount: 2 });
    expect(bytes).toHaveLength(36);
    expect(Array.from(bytes.subarray(0, 6))).toEqual([0x4E, 0x69, 0x67, 0x68, 0x74, 0x00]);
    expect(Array.from(bytes.subarray(32))).toEqual([2, 0, 0, 0]);
  });

  it('CsMacro is 132 bytes and decodes steps[1].preDelay at its own offset', () => {
    expect(Codec.sizeOf(Wire.CsMacro)).toBe(132);
    const steps = Array.from({ length: 8 }, () => (
      { noun: 0, action: 0, flags: 0, target: 0, index: 0, value: 0, step: 0, preDelay: 0 }
    ));
    const bytes = Codec.encode(Wire.CsMacro, { name: 'AB', stepCount: 2, steps });
    // steps[1] starts at offset 36 + 12 = 48; preDelay is the last 2 bytes of
    // a 12-byte step, so at 48 + 10 = 58.
    bytes[58] = 0x34;
    bytes[59] = 0x12;
    const macro = Codec.decode(Wire.CsMacro, bytes);
    expect(macro.steps).toHaveLength(8);
    expect(macro.steps[1].preDelay).toBe(0x1234);
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

  it('GetSpdifInputConfig (0xEF) decodes [count, enableMask, pin0, pin1, pin2, pin3]', () => {
    expect(Codec.sizeOf(Wire.SpdifInputConfig)).toBe(6);
    const bytes = Uint8Array.from([4, 0b0111, 5, 16, 17, 22]);
    const cfg = Codec.decode(Wire.SpdifInputConfig, bytes);
    expect(cfg).toEqual({ count: 4, enableMask: 0b0111, pins: [5, 16, 17, 22] });
  });

  it('I2SConfig round-trips the slave-clock pins at bytes 8-9', () => {
    expect(Codec.sizeOf(Wire.I2SConfig)).toBe(16);
    const bytes = Codec.encode(Wire.I2SConfig, {
      outputSlotTypes: [0, 0, 0, 0], bckPin: 14, mckPin: 13, mckEnabled: false, mckMultiplierEncoded: 0,
      clockPinModeP1: 2, bckPinSlave: 26,
    });
    expect(bytes[8]).toBe(2);
    expect(bytes[9]).toBe(26);
    const back = Codec.decode(Wire.I2SConfig, bytes);
    expect(back.clockPinModeP1).toBe(2);
    expect(back.bckPinSlave).toBe(26);
  });

  it('I2sSlaveStatus is 16 bytes and round-trips its fields', () => {
    expect(Codec.sizeOf(Wire.I2sSlaveStatus)).toBe(16);
    const bytes = Codec.encode(Wire.I2sSlaveStatus, {
      state: 3, clockMode: 1, lockCount: 2, lossCount: 1,
      detectedRate: 48000, measuredHz: 48001, slipCount: 0,
    });
    const back = Codec.decode(Wire.I2sSlaveStatus, bytes);
    expect(back).toMatchObject({
      state: 3, clockMode: 1, lockCount: 2, lossCount: 1,
      detectedRate: 48000, measuredHz: 48001, slipCount: 0,
    });
  });

  it('SysClockRequest is 2 bytes', () => {
    expect(Codec.sizeOf(Wire.SysClockRequest)).toBe(2);
    const bytes = Codec.encode(Wire.SysClockRequest, { mode: 1, vregSel: 0xFF });
    expect(bytes).toEqual(Uint8Array.from([1, 0xFF]));
  });

  it('SysClockStatus is 8 bytes and round-trips its fields', () => {
    expect(Codec.sizeOf(Wire.SysClockStatus)).toBe(8);
    const bytes = Codec.encode(Wire.SysClockStatus, {
      activeMode: 0, storedMode: 1, storedVregSel: 0xFF, liveVreg: 12, fallbackActive: true,
    });
    const back = Codec.decode(Wire.SysClockStatus, bytes);
    expect(back).toMatchObject({
      activeMode: 0, storedMode: 1, storedVregSel: 0xFF, liveVreg: 12, fallbackActive: true,
    });
  });

  it('AdatStatus is 8 bytes and round-trips its fields', () => {
    expect(Codec.sizeOf(Wire.AdatStatus)).toBe(8);
    const bytes = Codec.encode(Wire.AdatStatus, {
      enabled: true, active: true, pin: 12, rateOk: true, resyncCount: 2, slipCount: 0,
    });
    const back = Codec.decode(Wire.AdatStatus, bytes);
    expect(back).toMatchObject({
      enabled: true, active: true, pin: 12, rateOk: true, resyncCount: 2, slipCount: 0,
    });
  });

  it('AdatInputStatus decodes the fw byte layout at the spec offsets', () => {
    expect(Codec.sizeOf(Wire.AdatInputStatus)).toBe(20);
    // Literal packet, not an encode round-trip: pins the field offsets and
    // LE byte order against the 20-byte AdatInputStatusPacket spec.
    const bytes = new Uint8Array([
      3, 1, 1, 20, 1, 4, 1, 2,   // state..slipCount
      0x2C, 0x01, 0, 0,          // headerErr=300 LE, reserved
      0x80, 0xBB, 0, 0,          // detectedRate=48000 LE
      0x7E, 0xBB, 0, 0,          // measuredHz=47998 LE
    ]);
    expect(Codec.decode(Wire.AdatInputStatus, bytes)).toMatchObject({
      state: 3, clockMode: 1, enabled: true, pin: 20, rateOk: true,
      lockCount: 4, lossCount: 1, slipCount: 2, headerErr: 300,
      detectedRate: 48000, measuredHz: 47998,
    });
  });

  it('SubharmParams matches the fw wire byte layout, both directions', () => {
    expect(Codec.sizeOf(Wire.SubharmParams)).toBe(16);
    const value = { enabled: true, outputMask: 0x0103, lowDb: -6, highDb: 0, boostDb: 3 };
    const bytes = new Uint8Array([
      0x01, 0x00, 0x03, 0x01,             // enabled, reserved0, outputMask LE
      0x00, 0x00, 0xC0, 0xC0,             // lowDb = -6.0 f32 LE
      0x00, 0x00, 0x00, 0x00,             // highDb = 0.0 f32 LE
      0x00, 0x00, 0x40, 0x40,             // boostDb = 3.0 f32 LE
    ]);
    expect(Codec.encode(Wire.SubharmParams, value)).toEqual(bytes);
    expect(Codec.decode(Wire.SubharmParams, bytes)).toMatchObject(value);
  });

  it('CsDisplayCfg/CsDisplayCfgResponse/CsDisplayPage/CsDisplayStatus match the fw wire byte layout and sizes', () => {
    expect(Codec.sizeOf(Wire.CsDisplayCfg)).toBe(12);
    expect(Codec.sizeOf(Wire.CsDisplayCfgResponse)).toBe(16);
    expect(Codec.sizeOf(Wire.CsDisplayPage)).toBe(4);
    expect(Codec.sizeOf(Wire.CsDisplayStatus)).toBe(8);

    const cfg = { mode: 1, homePage: 2, dwell: 30, overlayHold: 20, brightness: 128, flags: 0x16, editTimeout: 100 };
    const cfgBytes = Uint8Array.from([0x01, 0x02, 0x1E, 0x00, 0x14, 0x00, 0x80, 0x16, 0x64, 0x00, 0x00, 0x00]);
    expect(Codec.encode(Wire.CsDisplayCfg, cfg)).toEqual(cfgBytes);
    expect(Codec.decode(Wire.CsDisplayCfg, cfgBytes)).toEqual(cfg);

    const responseBytes = Uint8Array.from([
      16, 9, 0, 0,                                              // maxPages, modelCount, reserved
      0x00, 0x00, 0x1E, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,  // cfg, dwell=30
    ]);
    const response = Codec.decode(Wire.CsDisplayCfgResponse, responseBytes);
    expect(response.maxPages).toBe(16);
    expect(response.modelCount).toBe(9);
    expect(response.cfg.dwell).toBe(30);

    const statusBytes = Uint8Array.from([0x02, 0xFF, 0x03, 0x06, 0x34, 0x12, 0x00, 0x00]);
    expect(Codec.decode(Wire.CsDisplayStatus, statusBytes)).toEqual({
      initState: 2, currentPage: 0xFF, flags: 3, model: 6, nakCount: 0x1234,
    });
  });

  it('BuildInfo is 64 bytes and trims each NUL-padded window on decode', () => {
    expect(Codec.sizeOf(Wire.BuildInfo)).toBe(64);
    const bytes = new Uint8Array(64);
    bytes.set(new TextEncoder().encode('v1.1.6-beta2-4-g56b2ec8-dirty\0'), 0);
    bytes.set(new TextEncoder().encode('2026-09-02\0'), 48);
    expect(Codec.decode(Wire.BuildInfo, bytes)).toEqual({
      describe: 'v1.1.6-beta2-4-g56b2ec8-dirty', date: '2026-09-02',
    });
  });

  it('BuildInfo decodes a full 47-char describe with no NUL inside its window', () => {
    const describe = 'v1.1.6-beta9999-999-g0123456789abcdef'.padEnd(47, '0');
    const bytes = new Uint8Array(64);
    bytes.set(new TextEncoder().encode(describe), 0);
    bytes.set(new TextEncoder().encode('2026-09-02\0'), 48);
    expect(Codec.decode(Wire.BuildInfo, bytes).describe).toBe(describe);
  });

});
