import { describe, it, expect } from 'vitest';
import { parseNotifyPacket, isReconcileTrigger, isPresetOpEcho, NotifyEventId, ParamSource } from './notify';

// Build a v2 header [version=2, event, flags=0, seq].
function v2(event: number, seq: number, rest: number[] = []): Uint8Array {
  return new Uint8Array([2, event, 0, seq, ...rest]);
}

describe('parseNotifyPacket', () => {
  it('treats a 1-byte 0x00 as idle', () => {
    expect(parseNotifyPacket(new Uint8Array([0]))).toEqual({ kind: 'idle' });
  });

  it('ignores a v1 packet (version byte != 2)', () => {
    expect(parseNotifyPacket(new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0]))).toEqual({ kind: 'ignored' });
  });

  it('decodes PARAM_CHANGED with its source and seq', () => {
    // [version, event, flags=0, seq] + offset(2) + size(2) + source(1) + reserved(3) + value(4)
    const pkt = v2(NotifyEventId.ParamChanged, 42, [0x80, 0x0b, 4, 0, ParamSource.Gpio, 0, 0, 0, 1, 2, 3, 4]);
    expect(parseNotifyPacket(pkt)).toEqual(expect.objectContaining({ kind: 'paramChanged', seq: 42, source: ParamSource.Gpio }));
  });

  it('decodes BULK_INVALIDATED with its source and seq', () => {
    expect(parseNotifyPacket(v2(NotifyEventId.BulkInvalidated, 7, [ParamSource.Preset, 0, 0, 0])))
      .toEqual({ kind: 'bulkInvalidated', seq: 7, source: ParamSource.Preset });
  });

  it('decodes PRESET_LOADED with its slot and seq', () => {
    expect(parseNotifyPacket(v2(NotifyEventId.PresetLoaded, 9, [3, 0, 0, 0])))
      .toEqual({ kind: 'presetLoaded', seq: 9, slot: 3 });
  });

  it('ignores an unknown v2 event id', () => {
    expect(parseNotifyPacket(v2(0x7e, 1))).toEqual({ kind: 'ignored' });
  });

  it('decodes I2S_SLAVE_STATE with its state and rate', () => {
    // rate 48000 = 0x0000BB80, little-endian.
    const pkt = v2(NotifyEventId.I2sSlaveState, 3, [3, 0x80, 0xBB, 0x00, 0x00]);
    expect(parseNotifyPacket(pkt)).toEqual({ kind: 'i2sSlaveState', seq: 3, state: 3, rateHz: 48000 });
  });

  it('ignores a truncated I2S_SLAVE_STATE packet (below the 9-byte minimum)', () => {
    const pkt = v2(NotifyEventId.I2sSlaveState, 3, [3, 0x80, 0xBB, 0x00]);   // 8 bytes total
    expect(parseNotifyPacket(pkt)).toEqual({ kind: 'ignored' });
  });

  it('decodes ADAT_INPUT_STATE with its state, rate and clock mode', () => {
    // rate 48000 = 0x0000BB80, little-endian; clockMode = 1 (slave).
    const pkt = v2(NotifyEventId.AdatInputState, 5, [3, 0x80, 0xBB, 0x00, 0x00, 1]);
    expect(parseNotifyPacket(pkt)).toEqual({ kind: 'adatInputState', seq: 5, state: 3, rateHz: 48000, clockMode: 1 });
  });

  it('ignores a truncated ADAT_INPUT_STATE packet (below the 10-byte minimum)', () => {
    const pkt = v2(NotifyEventId.AdatInputState, 5, [3, 0x80, 0xBB, 0x00, 0x00]);   // 9 bytes total
    expect(parseNotifyPacket(pkt)).toEqual({ kind: 'ignored' });
  });
});

describe('isReconcileTrigger', () => {
  it('triggers on bulkInvalidated and presetLoaded', () => {
    expect(isReconcileTrigger({ kind: 'bulkInvalidated', seq: 1, source: 0 })).toBe(true);
    expect(isReconcileTrigger({ kind: 'presetLoaded', seq: 1, slot: 0 })).toBe(true);
  });

  it('triggers on a non-HOST paramChanged but not a HOST echo', () => {
    expect(isReconcileTrigger({ kind: 'paramChanged', seq: 1, source: ParamSource.Gpio, offset: 0, size: 0, value: new Uint8Array() })).toBe(true);
    expect(isReconcileTrigger({ kind: 'paramChanged', seq: 1, source: ParamSource.Host, offset: 0, size: 0, value: new Uint8Array() })).toBe(false);
  });

  it('never triggers on idle or ignored', () => {
    expect(isReconcileTrigger({ kind: 'idle' })).toBe(false);
    expect(isReconcileTrigger({ kind: 'ignored' })).toBe(false);
  });
});

describe('isPresetOpEcho', () => {
  it('classes presetLoaded and host-initiated bulkInvalidated as echoes', () => {
    expect(isPresetOpEcho({ kind: 'presetLoaded', seq: 1, slot: 0 })).toBe(true);
    expect(isPresetOpEcho({ kind: 'bulkInvalidated', seq: 1, source: ParamSource.Preset })).toBe(true);
    expect(isPresetOpEcho({ kind: 'bulkInvalidated', seq: 1, source: ParamSource.Factory })).toBe(true);
    expect(isPresetOpEcho({ kind: 'bulkInvalidated', seq: 1, source: ParamSource.Host })).toBe(true);
  });

  it('does NOT class a GPIO change or a non-host bulkInvalidated as an echo', () => {
    expect(isPresetOpEcho({ kind: 'paramChanged', seq: 1, source: ParamSource.Gpio, offset: 0, size: 0, value: new Uint8Array() })).toBe(false);
    expect(isPresetOpEcho({ kind: 'bulkInvalidated', seq: 1, source: ParamSource.Gpio })).toBe(false);
    expect(isPresetOpEcho({ kind: 'idle' })).toBe(false);
  });
});

describe('parseNotifyPacket — PARAM_CHANGED payload', () => {
  // v2 header [2, event, flags, seq], then offset(u16 LE), size(u16 LE), source, 3 reserved, value bytes.
  it('extracts offset, size, source, and value bytes', () => {
    const pkt = new Uint8Array([2, 0x02, 0, 7, 20, 0, 1, 0, 5, 0, 0, 0, 0x99]);
    const ev = parseNotifyPacket(pkt);
    expect(ev).toEqual({ kind: 'paramChanged', seq: 7, source: 5, offset: 20, size: 1, value: expect.any(Uint8Array) });
    if (ev.kind === 'paramChanged') {
      expect(ev.offset).toBe(20);
      expect(ev.size).toBe(1);
      expect(Array.from(ev.value)).toEqual([0x99]);
    }
  });

  it('reads a multi-byte little-endian offset and a 4-byte value', () => {
    // offset 0x0123 = 291, size 4, value = 4 bytes
    const pkt = new Uint8Array([2, 0x02, 0, 1, 0x23, 0x01, 4, 0, 5, 0, 0, 0, 1, 2, 3, 4]);
    const ev = parseNotifyPacket(pkt);
    if (ev.kind !== 'paramChanged') throw new Error('expected paramChanged');
    expect(ev.offset).toBe(0x0123);
    expect(ev.size).toBe(4);
    expect(Array.from(ev.value)).toEqual([1, 2, 3, 4]);
  });

  it('ignores a PARAM_CHANGED whose declared size overruns the packet', () => {
    // size says 8 but only 1 value byte present
    const pkt = new Uint8Array([2, 0x02, 0, 1, 20, 0, 8, 0, 5, 0, 0, 0, 0x99]);
    expect(parseNotifyPacket(pkt)).toEqual({ kind: 'ignored' });
  });
});
