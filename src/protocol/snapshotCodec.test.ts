import { describe, expect, it } from 'vitest';
import { parseBulkParams, Wire } from '@/protocol';
import { makeBulk, makeBulkObject } from '@test/fixtures/bulkFixtures';
import { PlatformType, createHardwareProfile, matrixColumns, matrixRows, HARDWARE_PROFILES, AudioInputSource, FilterType } from '@/domain';
import * as WireNS from '@/protocol/wireTypes';
import { fromBulkParams } from './snapshotCodec';

describe('fromBulkParams', () => {
  it('maps protocol bulk data into an RP2350 domain snapshot', () => {
    const bulk = parseBulkParams(makeBulk({
      channelNames: ['', '', 'Left Woofer'],
      masterVolumeDb: -12.5,
      i2s: {
        outputSlotTypes: [1, 0, 0, 0],
        bckPin: 10,
        mckPin: 11,
        mckEnabled: true,
        mckMultiplierEncoded: 1,
      },
    }));
    const snapshot = fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk);

    expect(snapshot.platform.name).toBe('RP2350');
    expect(snapshot.outputs).toHaveLength(9);
    expect(snapshot.channels).toHaveLength(11);
    expect(snapshot.masterVolumeDb).toBeCloseTo(-12.5);
    const columns = matrixColumns(snapshot);
    expect(columns[0].name).toBe('Left Woofer');
    expect(columns[0].outputMode).toBe('I2S');
    expect(columns[8].outputMode).toBe('PDM');
    expect(snapshot.outputs[8].wireIndex).toBe(8);
    expect(snapshot.routes).toHaveLength(18);
  });

  it('maps RP2040 PDM to compact matrix slot 4', () => {
    const outputs = Array.from({ length: 9 }, () => ({
      enabled: false,
      muted: false,
      gainDb: 0,
      delayMs: 0,
    }));
    outputs[4] = { enabled: true, muted: false, gainDb: -4, delayMs: 1.25 };
    outputs[8] = { enabled: false, muted: true, gainDb: -8, delayMs: 8.5 };

    const crosspoints = Array.from({ length: 2 }, () =>
      Array.from({ length: 9 }, () => ({ enabled: false, invert: false, gainDb: 0 })),
    );
    crosspoints[0][4] = { enabled: true, invert: true, gainDb: -3 };
    crosspoints[0][8] = { enabled: false, invert: false, gainDb: -9 };

    const bulk = parseBulkParams(makeBulk({ platformId: 0, outputs, crosspoints }));
    const snapshot = fromBulkParams(createHardwareProfile(PlatformType.RP2040), bulk);
    const pdm = snapshot.outputs.find((output) => output.id === 10);
    const pdmRoute = snapshot.routes.find((route) => route.inputIndex === 0 && route.outputId === 10);

    expect(matrixColumns(snapshot)).toHaveLength(5);
    expect(matrixRows(snapshot)).toHaveLength(2);
    expect(matrixRows(snapshot)[0].cells).toHaveLength(5);
    expect(snapshot.channels ?? []).toHaveLength(7);
    expect(pdm?.wireIndex).toBe(4);
    expect(pdm?.enabled).toBe(true);
    expect(pdm?.gainDb).toBeCloseTo(-4);
    expect(pdmRoute?.outputWireIndex).toBe(4);
    expect(pdmRoute?.enabled).toBe(true);
    expect(pdmRoute?.invert).toBe(true);
  });

  it('maps RP2040 PDM EQ and name from firmware channel 6', () => {
    const filters = Array.from({ length: 11 }, () =>
      Array.from({ length: 12 }, () => ({ type: 0, bypass: false, frequency: 1000, q: 1, gain: 0 })),
    );
    filters[6][0] = { type: 1, bypass: false, frequency: 321, q: 0.8, gain: -2 };
    filters[10][0] = { type: 1, bypass: false, frequency: 9999, q: 2, gain: 12 };

    const names: string[] = [];
    names[6] = 'RP2040 Sub';
    names[10] = 'Wrong PDM';

    const bulk = parseBulkParams(makeBulk({
      platformId: 0,
      numCh: 7,
      filters,
      channelNames: names,
    }));
    const snapshot = fromBulkParams(createHardwareProfile(PlatformType.RP2040), bulk);
    const pdmChannel = snapshot.channels.find((channel) => channel.id === 10);
    const pdmColumn = matrixColumns(snapshot).find((column) => column.id === 10);

    expect(pdmChannel?.name).toBe('RP2040 Sub');
    expect(pdmColumn?.name).toBe('RP2040 Sub');
    expect(pdmChannel?.filters[0].frequency).toBe(321);
    expect(pdmChannel?.filters[0].gain).toBe(-2);
  });

  it('carries floor sections (i2s/leveller) even when the wire payload omits them', () => {
    // A V6 header truncated to the V3 payload length: bulkLayout drops leveller.
    // i2s/leveller are floor sections the domain treats as guaranteed, so the
    // codec defaults them rather than exposing null. (A real device sending such
    // a truncated payload is rejected at connect — see DspDevice's truncation
    // guard — so this only governs the codec's permissive behavior.)
    const bulk = makeBulkObject({ payloadLength: Wire.BulkSizes.V3 });
    const layout = Wire.bulkLayout(bulk);
    expect(layout.i2s).toBe(true);       // precondition: V3 keeps i2s
    expect(layout.leveller).toBe(false); // precondition: V3 drops leveller

    const snap = fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk);
    expect(snap.i2s).not.toBeNull();
    expect(snap.leveller).not.toBeNull();
  });
});

// RP2350 profile (11ch/9out) matches the default fixture shape.
const hw = HARDWARE_PROFILES[PlatformType.RP2350];

describe('snapshotCodec — 1.1.4 sections', () => {
  it('maps the V10 tail into nullable domain sections', () => {
    const bulk = makeBulkObject({
      formatVersion: 10, payloadLength: WireNS.BulkSizes.V10,
      inputConfig: { source: 1, spdifRxPin: 5 },
      lgSoundSync: { enabled: true, present: false, volume: 30, muted: false },
      userVolume:  { volumeDb: -4, mute: false },
      dacHwMute:   { enabled: true, activeLow: true, pin: 11, holdMs: 10, releaseMs: 20 },
    });
    const snap = fromBulkParams(hw, bulk);
    expect(snap.inputConfig).toEqual({ source: AudioInputSource.Spdif, spdifRxPin: 5 });
    expect(snap.lgSoundSync).toEqual({ enabled: true, present: false, volume: 30, muted: false });
    expect(snap.userVolume).toEqual({ volumeDb: -4, mute: false });
    expect(snap.dacHwMute).toEqual({ enabled: true, activeLow: true, pin: 11, holdMs: 10, releaseMs: 20 });
  });

  it('nulls the 1.1.4 sections on a V6 packet', () => {
    const snap = fromBulkParams(hw, makeBulkObject()); // V6 default
    expect(snap.inputConfig).toBeNull();
    expect(snap.lgSoundSync).toBeNull();
    expect(snap.userVolume).toBeNull();
    expect(snap.dacHwMute).toBeNull();
  });

  it('carries per-band bypass into FilterParams', () => {
    const filters = Array.from({ length: WireNS.Const.NUM_CHANNELS }, () =>
      Array.from({ length: WireNS.Const.BANDS_MAX }, () => ({ type: 1, bypass: false, frequency: 1000, q: 1, gain: 0 })));
    filters[0][0] = { type: 1, bypass: true, frequency: 1000, q: 1, gain: 2 };
    const snap = fromBulkParams(hw, makeBulkObject({ formatVersion: 10, payloadLength: WireNS.BulkSizes.V10, filters }));
    expect(snap.channels[0].filters[0].bypass).toBe(true);
  });

  it('narrows Notch/Allpass wire types and clamps an unknown type to Flat', () => {
    const filters = Array.from({ length: WireNS.Const.NUM_CHANNELS }, () =>
      Array.from({ length: WireNS.Const.BANDS_MAX }, () => ({ type: 0, bypass: false, frequency: 1000, q: 1, gain: 0 })));
    filters[0][0] = { type: FilterType.Notch, bypass: false, frequency: 1000, q: 1, gain: 0 };
    filters[0][1] = { type: FilterType.Allpass, bypass: false, frequency: 1000, q: 1, gain: 0 };
    filters[0][2] = { type: 99, bypass: false, frequency: 1000, q: 1, gain: 0 };
    const snap = fromBulkParams(hw, makeBulkObject({ formatVersion: 10, payloadLength: WireNS.BulkSizes.V10, filters }));
    expect(snap.channels[0].filters[0].type).toBe(FilterType.Notch);
    expect(snap.channels[0].filters[1].type).toBe(FilterType.Allpass);
    expect(snap.channels[0].filters[2].type).toBe(FilterType.Flat);
  });
});
