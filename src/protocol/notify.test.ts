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
    // [version, event, flags=0, seq] + offset(2) + size(2) + source(1) + reserved(3)
    const pkt = v2(NotifyEventId.ParamChanged, 42, [0x80, 0x0b, 4, 0, ParamSource.Gpio, 0, 0, 0]);
    expect(parseNotifyPacket(pkt)).toEqual({ kind: 'paramChanged', seq: 42, source: ParamSource.Gpio });
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
});

describe('isReconcileTrigger', () => {
  it('triggers on bulkInvalidated and presetLoaded', () => {
    expect(isReconcileTrigger({ kind: 'bulkInvalidated', seq: 1, source: 0 })).toBe(true);
    expect(isReconcileTrigger({ kind: 'presetLoaded', seq: 1, slot: 0 })).toBe(true);
  });

  it('triggers on a non-HOST paramChanged but not a HOST echo', () => {
    expect(isReconcileTrigger({ kind: 'paramChanged', seq: 1, source: ParamSource.Gpio })).toBe(true);
    expect(isReconcileTrigger({ kind: 'paramChanged', seq: 1, source: ParamSource.Host })).toBe(false);
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
    expect(isPresetOpEcho({ kind: 'paramChanged', seq: 1, source: ParamSource.Gpio })).toBe(false);
    expect(isPresetOpEcho({ kind: 'bulkInvalidated', seq: 1, source: ParamSource.Gpio })).toBe(false);
    expect(isPresetOpEcho({ kind: 'idle' })).toBe(false);
  });
});
