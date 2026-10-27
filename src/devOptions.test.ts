import { describe, it, expect, afterEach } from 'vitest';
import * as DevOptions from './devOptions';

afterEach(() => window.history.replaceState({}, '', '/'));

describe('mockToken', () => {
  it('is null when ?mock is absent', () => {
    window.history.replaceState({}, '', '/');
    expect(DevOptions.mockToken()).toBeNull();
  });

  it('is the empty string for a bare ?mock', () => {
    window.history.replaceState({}, '', '/?mock');
    expect(DevOptions.mockToken()).toBe('');
  });

  it('passes the raw value through unvalidated', () => {
    window.history.replaceState({}, '', '/?mock=v18');
    expect(DevOptions.mockToken()).toBe('v18');
  });
});

describe('mockChip', () => {
  it('is null when &chip is absent', () => {
    window.history.replaceState({}, '', '/?mock');
    expect(DevOptions.mockChip()).toBeNull();
  });

  it('reads a recognized chip value', () => {
    window.history.replaceState({}, '', '/?mock=legacy&chip=rp2040');
    expect(DevOptions.mockChip()).toBe('rp2040');
  });

  it('treats an unrecognized chip value as absent', () => {
    window.history.replaceState({}, '', '/?mock&chip=esp32');
    expect(DevOptions.mockChip()).toBeNull();
  });
});

describe('heroOverride', () => {
  it('is true when ?hero is present', () => {
    window.history.replaceState({}, '', '/?hero');
    expect(DevOptions.heroOverride()).toBe(true);
  });

  it('is true alongside ?mock (orthogonal axes)', () => {
    window.history.replaceState({}, '', '/?mock=rp2350&hero');
    expect(DevOptions.heroOverride()).toBe(true);
  });

  it('is false when ?hero is absent', () => {
    window.history.replaceState({}, '', '/');
    expect(DevOptions.heroOverride()).toBe(false);
  });
});

describe('mockSysClockFallback', () => {
  it('is true on ?sysclock=fallback', () => {
    window.history.replaceState({}, '', '/?mock&sysclock=fallback');
    expect(DevOptions.mockSysClockFallback()).toBe(true);
  });

  it('is false when ?sysclock is absent or has another value', () => {
    window.history.replaceState({}, '', '/?mock');
    expect(DevOptions.mockSysClockFallback()).toBe(false);
    window.history.replaceState({}, '', '/?mock&sysclock=other');
    expect(DevOptions.mockSysClockFallback()).toBe(false);
  });
});

describe('log axis', () => {
  it('silences logging on ?log=0 without enabling the wire monitor', () => {
    window.history.replaceState({}, '', '/?log=0');
    expect(DevOptions.logSilenced()).toBe(true);
    expect(DevOptions.wireLogEnabled()).toBe(false);
  });

  it('enables the wire monitor on ?log=wire without silencing logging', () => {
    window.history.replaceState({}, '', '/?log=wire');
    expect(DevOptions.wireLogEnabled()).toBe(true);
    expect(DevOptions.logSilenced()).toBe(false);
  });

  it('leaves both off when ?log is absent', () => {
    window.history.replaceState({}, '', '/');
    expect(DevOptions.logSilenced()).toBe(false);
    expect(DevOptions.wireLogEnabled()).toBe(false);
  });
});
