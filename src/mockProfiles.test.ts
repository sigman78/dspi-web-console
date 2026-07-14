import { describe, it, expect } from 'vitest';
import { resolveMockProfile } from './mockProfiles';
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
