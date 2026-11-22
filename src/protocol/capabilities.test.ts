import { describe, it, expect } from 'vitest';
import { deriveCapabilities, MAX_KNOWN_WIRE } from './capabilities';
import { Wire } from '@/protocol';

const fw = (major: number, minor: number, patch: number) => ({ major, minor, patch });

const derive = (wireVersion: number, platformId = 1, fwVersion = fw(1, 1, 6)) =>
  deriveCapabilities({ fw: fwVersion, wireVersion, payloadLength: Wire.bulkSizeForVersion(wireVersion), platformId });

describe('deriveCapabilities — support classification', () => {
  it('rejects every wire below the V28 floor as unsupported', () => {
    // 1.1.4 (V10), the V16-V27 betas and the 11..15 intermediates.
    for (const v of [6, 9, 10, 12, 16, 27]) {
      expect(derive(v, 1, fw(1, 1, 4)).support).toBe('unsupported');
    }
  });

  it('classifies V28 (1.1.5 release) through V32 as supported', () => {
    expect(derive(28, 1, fw(1, 1, 5)).support).toBe('supported');
    for (const v of [29, 30, 31, 32]) expect(derive(v).support).toBe('supported');
  });

  it('classifies a wire version beyond MAX_KNOWN_WIRE as future', () => {
    expect(derive(MAX_KNOWN_WIRE + 1, 1, fw(1, 2, 0)).support).toBe('future');
  });
});

describe('deriveCapabilities — feature flags', () => {
  it('RP2350 exposes the platform-gated hardware features', () => {
    const f = derive(28).features;
    expect(f).toMatchObject({
      multichannelInput: true, multiSpdifInputs: true, adatOutput: true,
      adatInput: true, psybass: true, upmix: true,
    });
    expect(derive(28).spdifInputCount).toBe(4);
  });

  it('RP2040 stays stereo-only with a single S/PDIF input', () => {
    const c = derive(28, 0);
    expect(c.features).toMatchObject({
      multichannelInput: false, multiSpdifInputs: false, adatOutput: false,
      adatInput: false, psybass: false, upmix: false,
    });
    expect(c.spdifInputCount).toBe(1);
  });

  it('gates the subharmonic synthesizer on wire V29, ungated on platform', () => {
    expect(derive(28).features.subharm).toBe(false);
    expect(derive(29, 0).features.subharm).toBe(true);
    expect(derive(29, 1).features.subharm).toBe(true);
  });

  it('gates build-stamp readout on wire V29', () => {
    expect(derive(28).features.buildStamp).toBe(false);
    expect(derive(29).features.buildStamp).toBe(true);
  });

  it('gates the onboard RTA try on wire V30', () => {
    expect(derive(29).features.rta).toBe(false);
    expect(derive(30).features.rta).toBe(true);
  });

  it('gates the subharm section tail (third band/selectivity/ceiling/pair link) on wire V30', () => {
    expect(derive(29).features.subharmExt).toBe(false);
    expect(derive(30).features.subharmExt).toBe(true);
  });

  it('gates the tube preamp on wire V31 and the limiter on V32, ungated on platform', () => {
    expect(derive(30).features).toMatchObject({ tube: false, limiter: false });
    expect(derive(31, 0).features).toMatchObject({ tube: true, limiter: false });
    expect(derive(32, 0).features).toMatchObject({ tube: true, limiter: true });
    expect(derive(32, 1).features).toMatchObject({ tube: true, limiter: true });
  });
});

describe('deriveCapabilities — metadata + sections', () => {
  it('carries fw, wire, platformId and display labels through for display / escape-hatch use', () => {
    const c = derive(28, 1, fw(1, 1, 5));
    expect(c.fw).toEqual(fw(1, 1, 5));
    expect(c.fwLabel).toBe('1.1.5');
    expect(c.wire).toBe(28);
    expect(c.wireLabel).toBe('V28');
    expect(c.platformId).toBe(1);
  });

  it('labels a pre-release build with its beta ordinal', () => {
    const c = deriveCapabilities({
      fw: { ...fw(1, 1, 6), beta: 4 }, wireVersion: 32, payloadLength: Wire.BULK_SIZE_V32, platformId: 1,
    });
    expect(c.fwLabel).toBe('1.1.6 beta 4');
  });

  it('derives bulk sections from the observed header by delegating to bulkLayout', () => {
    const c = derive(30);
    expect(c.sections).toEqual(Wire.bulkLayout({ formatVersion: 30, payloadLength: Wire.BULK_SIZE_V30 }));
  });

  it('reflects a packet truncated below the limiter tail as lacking that section', () => {
    const c = deriveCapabilities({
      fw: fw(1, 1, 6), wireVersion: 32, payloadLength: Wire.BULK_SIZE_V31, platformId: 1,
    });
    expect(c.sections.tube).toBe(true);
    expect(c.sections.limiter).toBe(false);
  });
});

describe('deriveCapabilities — paged generation', () => {
  const paged = (wireVersion: number) =>
    deriveCapabilities({ fw: fw(1, 1, 7), wireVersion, payloadLength: 6136, platformId: 1, generation: 'paged' });

  it('supports only V34, with newer wires future and older unsupported', () => {
    expect(paged(34).support).toBe('supported');
    expect(paged(35).support).toBe('future');
    expect([paged(33).support, paged(32).support]).toEqual(['unsupported', 'unsupported']);
  });

  it('is read-only, and a feature needs its command in the catalog', () => {
    const caps = paged(34);
    expect(caps.readOnly).toBe(true);
    expect(caps.features.tube).toBe(false);
  });

  it('keeps the V32 window for the same wire on legacy firmware', () => {
    expect(derive(32).support).toBe('supported');
    expect(deriveCapabilities({ fw: fw(1, 1, 6), wireVersion: 34, payloadLength: 6136, platformId: 1 }).support).toBe('future');
  });
});
