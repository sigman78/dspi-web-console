import { describe, it, expect, afterEach } from 'vitest';
import { WireCmd } from '@/protocol';
import { isPollCommand, wireMonitorEnabled } from './wireMonitor';

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
