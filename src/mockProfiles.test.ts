import { describe, it, expect, afterEach } from 'vitest';
import { resolveMockProfile, resolveMockProfiles, activeMockProfiles } from './mockProfiles';
import * as Wire from './protocol/wireTypes';

describe('resolveMockProfile', () => {
  it('falls back to latest for an unrecognized token (e.g. an old spelling)', () => {
    const p = resolveMockProfile('hero');
    expect(p.name).toBe('latest');
    expect(p.opts.wireVersion).toBe(Wire.MAX_WIRE_VERSION);
  });

  it('resolves a bare token to latest', () => {
    const p = resolveMockProfile('');
    expect(p.name).toBe('latest');
  });

  it('parses v<N> to an exact wire version, fw 1.1.5 for V16+', () => {
    const p = resolveMockProfile('v18');
    expect(p.opts.wireVersion).toBe(18);
    expect(p.opts.fwVersion).toEqual({ major: 1, minor: 1, patch: 5 });
  });

  it('parses v10 with fw 1.1.4', () => {
    const p = resolveMockProfile('v10');
    expect(p.opts.wireVersion).toBe(10);
    expect(p.opts.fwVersion).toEqual({ major: 1, minor: 1, patch: 4 });
  });

  it('parses v27/v28 with fw 1.1.6, while v26 stays on 1.1.5', () => {
    expect(resolveMockProfile('v26').opts.fwVersion).toEqual({ major: 1, minor: 1, patch: 5 });
    expect(resolveMockProfile('v27').opts.fwVersion).toEqual({ major: 1, minor: 1, patch: 6 });
    expect(resolveMockProfile('v28').opts.fwVersion).toEqual({ major: 1, minor: 1, patch: 6 });
  });

  it('parses v29 (subharmonic synthesizer) with fw 1.1.6', () => {
    const p = resolveMockProfile('v29');
    expect(p.opts.wireVersion).toBe(29);
    expect(p.opts.fwVersion).toEqual({ major: 1, minor: 1, patch: 6 });
  });

  it('latest boots at MAX_WIRE_VERSION with fw 1.1.6', () => {
    const p = resolveMockProfile('latest');
    expect(p.opts.wireVersion).toBe(Wire.MAX_WIRE_VERSION);
    expect(p.opts.fwVersion).toEqual({ major: 1, minor: 1, patch: 6 });
  });

  it('falls back to latest for wire versions the console never supported (11..15)', () => {
    expect(resolveMockProfile('v12').name).toBe('latest');
  });

  it('falls back to latest below the connect floor', () => {
    expect(resolveMockProfile('v9').name).toBe('latest');
  });

  it('falls back to latest above MAX_WIRE_VERSION', () => {
    expect(resolveMockProfile('v99').name).toBe('latest');
  });

  it('carries the multichannel shape for the multi profile', () => {
    const p = resolveMockProfile('multi');
    expect(p.opts.i2sInputChannels).toBe(8);
    expect(p.opts.spdifInputsEnabled).toBe(3);
  });

  it('combines the chip axis with any profile', () => {
    const p = resolveMockProfile('legacy', 'rp2040');
    expect(p.name).toBe('legacy');
    expect(p.platform).toBe('rp2040');
    expect(p.opts.wireVersion).toBe(10);
  });

  it('treats the rp2040 token as a chip shorthand for latest', () => {
    const p = resolveMockProfile('rp2040');
    expect(p.name).toBe('latest');
    expect(p.platform).toBe('rp2040');
  });

  it('lets an explicit chip win over the token shorthand', () => {
    expect(resolveMockProfile('rp2040', 'rp2350').platform).toBe('rp2350');
  });

  it('defaults to rp2350 when the chip is absent', () => {
    expect(resolveMockProfile('multi', null).platform).toBe('rp2350');
  });
});

describe('resolveMockProfiles', () => {
  it('splits a comma list into one profile per token', () => {
    const list = resolveMockProfiles('latest,legacy');
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe('latest');
    expect(list[1].name).toBe('legacy');
    expect(list[1].opts.wireVersion).toBe(10);
  });

  it('a single token yields the same profile as resolveMockProfile', () => {
    expect(resolveMockProfiles('multi')).toEqual([resolveMockProfile('multi')]);
  });

  it('empty entries resolve to latest, and chip applies to every entry', () => {
    const list = resolveMockProfiles(',legacy', 'rp2040');
    expect(list[0].name).toBe('latest');
    expect(list.every((p) => p.platform === 'rp2040')).toBe(true);
  });
});

describe('activeMockProfiles', () => {
  afterEach(() => window.history.replaceState({}, '', '/'));

  it('carries no sysClockBoot override by default', () => {
    window.history.replaceState({}, '', '/?mock');
    expect(activeMockProfiles()?.[0].opts.sysClockBoot).toBeUndefined();
  });

  it('seeds every profile with a crash-fallback boot on ?sysclock=fallback', () => {
    window.history.replaceState({}, '', '/?mock=latest,legacy&sysclock=fallback');
    const profiles = activeMockProfiles();
    expect(profiles).toHaveLength(2);
    expect(profiles?.every((p) => p.opts.sysClockBoot?.storedMode === 2 && p.opts.sysClockBoot?.fallback === true)).toBe(true);
  });
});
