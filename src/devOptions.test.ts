import { describe, it, expect, afterEach } from 'vitest';
import { mockToken, mockChip, heroOverride, logSilenced, wireLogEnabled, mockSysClockFallback, debugPanelsForced } from './devOptions';

afterEach(() => window.history.replaceState({}, '', '/'));

describe('mockToken', () => {
  it('is null when ?mock is absent', () => {
    window.history.replaceState({}, '', '/');
    expect(mockToken()).toBeNull();
  });

  it('is the empty string for a bare ?mock', () => {
    window.history.replaceState({}, '', '/?mock');
    expect(mockToken()).toBe('');
  });

  it('passes the raw value through unvalidated', () => {
    window.history.replaceState({}, '', '/?mock=v18');
    expect(mockToken()).toBe('v18');
  });
});

describe('mockChip', () => {
  it('is null when &chip is absent', () => {
    window.history.replaceState({}, '', '/?mock');
    expect(mockChip()).toBeNull();
  });

  it('reads a recognized chip value', () => {
    window.history.replaceState({}, '', '/?mock=legacy&chip=rp2040');
    expect(mockChip()).toBe('rp2040');
  });

  it('treats an unrecognized chip value as absent', () => {
    window.history.replaceState({}, '', '/?mock&chip=esp32');
    expect(mockChip()).toBeNull();
  });
});

describe('heroOverride', () => {
  it('is true when ?hero is present', () => {
    window.history.replaceState({}, '', '/?hero');
    expect(heroOverride()).toBe(true);
  });

  it('is true alongside ?mock (orthogonal axes)', () => {
    window.history.replaceState({}, '', '/?mock=rp2350&hero');
    expect(heroOverride()).toBe(true);
  });

  it('is false when ?hero is absent', () => {
    window.history.replaceState({}, '', '/');
    expect(heroOverride()).toBe(false);
  });
});

describe('mockSysClockFallback', () => {
  it('is true on ?sysclock=fallback', () => {
    window.history.replaceState({}, '', '/?mock&sysclock=fallback');
    expect(mockSysClockFallback()).toBe(true);
  });

  it('is false when ?sysclock is absent or has another value', () => {
    window.history.replaceState({}, '', '/?mock');
    expect(mockSysClockFallback()).toBe(false);
    window.history.replaceState({}, '', '/?mock&sysclock=other');
    expect(mockSysClockFallback()).toBe(false);
  });
});

describe('log axis', () => {
  it('silences logging on ?log=0 without enabling the wire monitor', () => {
    window.history.replaceState({}, '', '/?log=0');
    expect(logSilenced()).toBe(true);
    expect(wireLogEnabled()).toBe(false);
  });

  it('enables the wire monitor on ?log=wire without silencing logging', () => {
    window.history.replaceState({}, '', '/?log=wire');
    expect(wireLogEnabled()).toBe(true);
    expect(logSilenced()).toBe(false);
  });

  it('leaves both off when ?log is absent', () => {
    window.history.replaceState({}, '', '/');
    expect(logSilenced()).toBe(false);
    expect(wireLogEnabled()).toBe(false);
  });
});

describe('debugPanelsForced', () => {
  it('is true when ?debug is present, with any value', () => {
    window.history.replaceState({}, '', '/?debug');
    expect(debugPanelsForced()).toBe(true);
    window.history.replaceState({}, '', '/?debug=1');
    expect(debugPanelsForced()).toBe(true);
  });

  it('is false when ?debug is absent', () => {
    window.history.replaceState({}, '', '/');
    expect(debugPanelsForced()).toBe(false);
  });
});
