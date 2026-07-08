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
      // matrixColumns only surfaces enabled outputs; the fixture default is
      // disabled, so enable all 9 to exercise the full column set below.
      outputs: Array.from({ length: 9 }, () => ({ enabled: true, muted: false, gainDb: 0, delayMs: 0 })),
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
    // Compact slots 0-3 enabled so matrixColumns/matrixRows below cover the
    // full RP2040 output set; matrixColumns only surfaces enabled outputs.
    const outputs = Array.from({ length: 9 }, () => ({
      enabled: true,
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
      // matrixColumns only surfaces enabled outputs; enable the PDM slot
      // (compact index 4) so pdmColumn below can find it.
      outputs: Array.from({ length: 9 }, (_, i) => ({ enabled: i === 4, muted: false, gainDb: 0, delayMs: 0 })),
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
      inputConfig: { source: 1, spdifRxPin: 5, i2sRxPins: [0, 0, 0, 0], i2sInputRateEnc: 1, i2sInputChannels: 0 },
      lgSoundSync: { enabled: true, present: false, volume: 30, muted: false },
      userVolume:  { volumeDb: -4, mute: false },
      dacHwMute:   { enabled: true, activeLow: true, pin: 11, holdMs: 10, releaseMs: 20 },
    });
    const snap = fromBulkParams(hw, bulk);
    expect(snap.inputConfig).toEqual({ source: AudioInputSource.Spdif, spdifRxPin: 5, i2sRxPins: [0, 0, 0, 0], i2sInputRateHz: 48000, i2sInputChannels: 0 });
    expect(snap.lgSoundSync).toEqual({ enabled: true, present: false, volume: 30, muted: false });
    expect(snap.userVolume).toEqual({ volumeDb: -4, mute: false });
    expect(snap.dacHwMute).toEqual({ enabled: true, activeLow: true, pin: 11, holdMs: 10, releaseMs: 20 });
  });

  it('carries the parser-filled factory defaults for sections a packet omits', () => {
    const snap = fromBulkParams(hw, makeBulkObject({ formatVersion: 6, payloadLength: WireNS.BulkSizes.V6Full }));
    expect(snap.inputConfig).toEqual({ source: 0, spdifRxPin: 5, i2sRxPins: [0, 0, 0, 0], i2sInputRateHz: 48000, i2sInputChannels: 0 });
    expect(snap.userVolume).toEqual({ volumeDb: 0, mute: false });
    expect(snap.lgSoundSync.enabled).toBe(false);
    expect(snap.dacHwMute.enabled).toBe(false);
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

// V16 8-input RP2350 profile, for the multichannel USB/I2S naming cases.
const hw16 = createHardwareProfile(PlatformType.RP2350, 16);

function bulkWithSource(source: AudioInputSource, overrides: Partial<Parameters<typeof makeBulkObject>[0]> = {}) {
  return makeBulkObject({
    formatVersion: 16, payloadLength: WireNS.BULK_SIZE_V16,
    inputConfig: { source, spdifRxPin: 5, i2sRxPins: [1, 2, 3, 4], i2sInputRateEnc: 1, i2sInputChannels: 8 },
    ...overrides,
  });
}

describe('snapshotCodec — source-aware input defaults', () => {
  it('names USB inputs as independent channels (no L/R suffix on any of the 8)', () => {
    const snap = fromBulkParams(hw16, bulkWithSource(AudioInputSource.Usb));
    const inputs = snap.channels.filter((c) => !c.isOutput);
    expect(inputs.map((c) => c.name)).toEqual(['USB 1', 'USB 2', 'USB 3', 'USB 4', 'USB 5', 'USB 6', 'USB 7', 'USB 8']);
    expect(inputs.every((c) => !/[LR]$/.test(c.shortName))).toBe(true);
  });

  it('names I2S inputs as four true stereo pairs', () => {
    const snap = fromBulkParams(hw16, bulkWithSource(AudioInputSource.I2s));
    const inputs = snap.channels.filter((c) => !c.isOutput);
    expect(inputs.map((c) => c.name)).toEqual([
      'I2S 1 L', 'I2S 1 R', 'I2S 2 L', 'I2S 2 R', 'I2S 3 L', 'I2S 3 R', 'I2S 4 L', 'I2S 4 R',
    ]);
    expect(inputs.map((c) => c.shortName)).toEqual(['I1L', 'I1R', 'I2L', 'I2R', 'I3L', 'I3R', 'I4L', 'I4R']);
  });

  it('names S/PDIF as a single stereo pair regardless of the extra multichannel slots', () => {
    const snap = fromBulkParams(hw16, bulkWithSource(AudioInputSource.Spdif));
    expect(snap.channels[0].name).toBe('SPDIF L');
    expect(snap.channels[1].name).toBe('SPDIF R');
  });

  it('lets a device-supplied name win over the source default, while defaultName keeps tracking the source', () => {
    const bulk = bulkWithSource(AudioInputSource.Spdif, { channelNames: ['Turntable', ''] });
    const snap = fromBulkParams(hw16, bulk);
    expect(snap.channels[0].name).toBe('Turntable');        // device name wins over the default
    expect(snap.channels[0].defaultName).toBe('SPDIF L');   // default still reflects the live source
    expect(snap.channels[1].name).toBe('SPDIF R');           // no device name -> falls back to the default
  });

  it('leaves output channel default names unaffected by an input source change', () => {
    const outputDefaults = (source: AudioInputSource) =>
      fromBulkParams(hw16, bulkWithSource(source)).channels.filter((c) => c.isOutput).map((c) => c.defaultName);
    expect(outputDefaults(AudioInputSource.Usb)).toEqual(outputDefaults(AudioInputSource.I2s));
    expect(outputDefaults(AudioInputSource.Usb)).toEqual(outputDefaults(AudioInputSource.Spdif));
  });
});
