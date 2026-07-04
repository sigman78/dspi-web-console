import { describe, it, expect } from 'vitest';
import { parseSystemStatus } from './systemStatus';
import { synthesizeSystemStatus } from './systemStatus.syn';
import * as Wire from './wireTypes';

describe('parseSystemStatus', () => {
  it('parses RP2350 (11-channel) status', () => {
    const peaks = [0.5, 1.0, 0.0, 0.25, 0.125, 0.75, 0.5, 0.5, 0.5, 0.5, 0.1];
    const buf = synthesizeSystemStatus({ numCh: 11, peaks, cpu0: 42, cpu1: 19, clipFlags: 0xABCD });
    const s = parseSystemStatus(buf, 11);
    expect(s.peaks.length).toBe(Wire.Const.NUM_CHANNELS);
    for (let i = 0; i < 11; i++) expect(s.peaks[i]).toBeCloseTo(peaks[i], 3);
    expect(s.cpu0).toBe(42);
    expect(s.cpu1).toBe(19);
    expect(s.clipFlags).toBe(0xABCD);
    expect(s.isClipping(0)).toBe(true);
    expect(s.isClipping(1)).toBe(false);
    expect(s.isClipping(2)).toBe(true);
  });

  it('parses RP2040 (7-channel) status, leaves higher peaks at 0', () => {
    const peaks = [0.5, 1.0, 0.0, 0.25, 0.125, 0.75, 0.5];
    const buf = synthesizeSystemStatus({ numCh: 7, peaks, cpu0: 30, cpu1: 10, clipFlags: 0 });
    const s = parseSystemStatus(buf, 7);
    expect(s.peaks.length).toBe(Wire.Const.NUM_CHANNELS);
    for (let i = 0; i < 7; i++) expect(s.peaks[i]).toBeCloseTo(peaks[i], 3);
    for (let i = 7; i < 11; i++) expect(s.peaks[i]).toBe(0);
    expect(s.cpu0).toBe(30);
    expect(s.cpu1).toBe(10);
  });

  it('returns zeros when buffer is too short', () => {
    const s = parseSystemStatus(new Uint8Array(0), 11);
    expect(s.peaks.every((p) => p === 0)).toBe(true);
    expect(s.cpu0).toBe(0);
    expect(s.cpu1).toBe(0);
    expect(s.clipFlags).toBe(0);
  });
});
