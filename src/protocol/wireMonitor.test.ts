import { describe, it, expect, afterEach } from 'vitest';
import { WireCmd } from '@/protocol';
import { ParamSource } from './notify';
import { isPollCommand, wireMonitorEnabled, formatNotify } from './wireMonitor';

// The formatters and the connection banner only produce console text, which we
// deliberately don't assert on. What's worth testing here is behavior that isn't
// log output: the ?log=wire gate and which commands count as high-volume polls.

describe('wireMonitorEnabled', () => {
  afterEach(() => window.history.replaceState({}, '', '/'));

  it('is true when ?log=wire is present', () => {
    window.history.replaceState({}, '', '/?log=wire');
    expect(wireMonitorEnabled()).toBe(true);
  });

  it('is false when ?log is absent', () => {
    window.history.replaceState({}, '', '/');
    expect(wireMonitorEnabled()).toBe(false);
  });

  it('is false for other ?log values', () => {
    window.history.replaceState({}, '', '/?log=0');
    expect(wireMonitorEnabled()).toBe(false);
  });
});

describe('isPollCommand', () => {
  it('flags only the high-volume telemetry polls', () => {
    expect(isPollCommand(WireCmd.GetStatus.code)).toBe(true);
    expect(isPollCommand(WireCmd.GetBufferStats.code)).toBe(true);
    expect(isPollCommand(WireCmd.SetBypass.code)).toBe(false);
    expect(isPollCommand(WireCmd.GetAllParams.code)).toBe(false);
  });
});

describe('formatNotify — paramChanged offset enrichment', () => {
  it('names the field a GPIO write landed on, given the bulk version', () => {
    const pkt = new Uint8Array([2, 0x02, 0, 17, 0xbc, 0x04, 4, 0, ParamSource.Gpio, 0, 0, 0, 0, 0, 0, 0]);
    new DataView(pkt.buffer).setFloat32(12, 1337.25, true);
    const line = formatNotify(pkt, 26);
    expect(line).toContain('eq[ch2].band0.frequency');
    expect(line).toContain('1337.25');
  });
});
