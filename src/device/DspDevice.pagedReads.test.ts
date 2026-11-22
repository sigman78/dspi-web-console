import { describe, it, expect } from 'vitest';
import { DspDevice } from './DspDevice';
import { MockTransport } from '@/transport/MockTransport';
import { resolveMockProfile } from '@/mockProfiles';
import * as Domain from '@/domain';
import * as Svc from '@/runtime/deviceService';
import type { DeviceFeatures } from '@/protocol/capabilities';
import * as proto from '@/protocol';
import { translatingTransport } from '@/protocol/legacyTranslate';
import type { DspTransport } from '@/transport/DspTransport';

type Chip = 'rp2350' | 'rp2040';

async function connect(token: 'latest' | 'v34', chip: Chip): Promise<DspDevice> {
  const profile = resolveMockProfile(token, chip);
  return DspDevice.create(new MockTransport({ platform: profile.platform, ...profile.opts }));
}

interface Read { name: string; feature?: keyof DeviceFeatures; run: (d: DspDevice) => Promise<unknown> }

// Every device read the paged session now makes: the re-enabled poll cadences
// and the connect-time fetches.
const READS: Read[] = [
  { name: 'getBufferStats', run: (d) => d.getBufferStats() },
  { name: 'getSpdifRxStatus', run: (d) => d.getSpdifRxStatus() },
  { name: 'getI2sSlaveStatus', run: (d) => d.getI2sSlaveStatus() },
  { name: 'getAdatStatus', feature: 'adatOutput', run: (d) => d.getAdatStatus() },
  { name: 'getAdatInputStatus', feature: 'adatInput', run: (d) => d.getAdatInputStatus() },
  { name: 'getSubharmHeadroom', feature: 'subharm', run: (d) => d.getSubharmHeadroom() },
  { name: 'getSubharmMeter', feature: 'subharmExt', run: (d) => d.getSubharmMeter() },
  { name: 'getSubharmSolo', feature: 'subharmExt', run: (d) => d.getSubharmSolo() },
  { name: 'getLimiterMeter', feature: 'limiter', run: (d) => d.getLimiterMeter() },
  { name: 'getLimiterStatus', feature: 'limiter', run: (d) => d.getLimiterStatus() },
  { name: 'getCsExtStatus', run: (d) => d.getCsExtStatus() },
  { name: 'getCsDisplayStatus', run: (d) => d.getCsDisplayStatus() },
  { name: 'getPresetDirectory', run: (d) => d.getPresetDirectory() },
  { name: 'getActivePreset', run: (d) => d.getActivePreset() },
  { name: 'getSavedMasterVolume', run: (d) => d.getSavedMasterVolume() },
  { name: 'getPresetName', run: async (d) => Promise.all(Array.from({ length: Domain.PRESET_SLOT_COUNT }, (_, i) => d.getPresetName(i as Domain.PresetSlot))) },
  { name: 'getUartControlConfig', run: (d) => d.getUartControlConfig() },
  { name: 'getI2cControlConfig', run: (d) => d.getI2cControlConfig() },
  { name: 'getControlIfaceStatus', run: (d) => d.getControlIfaceStatus() },
  { name: 'getCsCaps', run: (d) => d.getCsCaps() },
  { name: 'getCsStatus', run: (d) => d.getCsStatus() },
  { name: 'getOutputLatencyStatus', run: (d) => d.getOutputLatencyStatus() },
  { name: 'getOutputLatencyOptions', run: (d) => d.getOutputLatencyOptions() },
  { name: 'probeInputSourceNames', run: (d) => d.probeInputSourceNames() },
  { name: 'probeDeviceName', run: (d) => d.probeDeviceName() },
  { name: 'getInputSourceName', run: async (d) => Promise.all([0, 1, 2].map((s) => d.getInputSourceName(s))) },
  { name: 'getDeviceName', run: (d) => d.getDeviceName() },
  {
    name: 'readCsAll',
    run: async (d) => {
      const { caps } = await d.getCsCaps();
      const all = await Svc.readCsAll(d, caps, (f) => f());
      // The display block is read on legacy only.
      return { ...all, display: null };
    },
  },
];

describe.each<Chip>(['rp2350', 'rp2040'])('paged reads match legacy reads on %s', (chip) => {
  it.each(READS.map((r) => [r.name, r] as const))('%s', async (_name, read) => {
    const [legacy, paged] = await Promise.all([connect('latest', chip), connect('v34', chip)]);
    if (read.feature && !legacy.capabilities.features[read.feature]) {
      expect(paged.capabilities.features[read.feature]).toBe(false);
      return;
    }
    expect(await read.run(paged)).toEqual(await read.run(legacy));
  });
});

// A legacy write or action applied straight to a mock, bypassing the read-only
// guard: raw on the legacy mock, translated onto the paged mock.
async function pair(chip: Chip) {
  const lp = resolveMockProfile('latest', chip);
  const pp = resolveMockProfile('v34', chip);
  const legacyMock = new MockTransport({ platform: lp.platform, ...lp.opts });
  const pagedMock = new MockTransport({ platform: pp.platform, ...pp.opts });
  const [legacy, paged] = await Promise.all([DspDevice.create(legacyMock), DspDevice.create(pagedMock)]);
  return {
    legacy, paged,
    legacyWire: legacyMock as DspTransport,
    pagedWire: translatingTransport(pagedMock) as DspTransport,
  };
}

describe('a read of a command the paged device lacks', () => {
  it('answers the 1.1.6 zero fill on an RP2040, which has no ADAT', async () => {
    const paged = await connect('v34', 'rp2040');
    expect(paged.capabilities.features.adatOutput).toBe(false);
    expect(await paged.getAdatStatus()).toMatchObject({ enabled: false, active: false, resyncCount: 0 });
  });
});

describe.each<Chip>(['rp2350', 'rp2040'])('a legacy write on the paged mock leaves the same state (%s)', (chip) => {
  it('direct SET with an address', async () => {
    const { legacyWire, pagedWire } = await pair(chip);
    for (const wire of [legacyWire, pagedWire]) await proto.writeCmd(wire, proto.Cmd.OutputDelay, 2.5, 1);
    const [l, p] = await Promise.all([legacyWire, pagedWire].map((w) => proto.readCmd(w, proto.Cmd.OutputDelay, 1)));
    expect(p).toBe(2.5);
    expect(p).toBe(l);
    expect(await proto.readCmd(pagedWire, proto.Cmd.OutputDelay, 0)).toBe(await proto.readCmd(legacyWire, proto.Cmd.OutputDelay, 0));
  });

  it('direct SET without an address', async () => {
    const { legacy, paged, legacyWire, pagedWire } = await pair(chip);
    for (const wire of [legacyWire, pagedWire]) await proto.writeCmd(wire, proto.Cmd.MasterVolume, -12, 0);
    expect(await paged.getMasterVolume()).toBe(-12);
    expect(await paged.getMasterVolume()).toEqual(await legacy.getMasterVolume());
  });

  it('act_value: the status byte and the stored value agree', async () => {
    const { legacy, paged, legacyWire, pagedWire } = await pair(chip);
    const status = await Promise.all([legacyWire, pagedWire].map((w) => proto.actionCmd(w, proto.Act.I2sClockPinMode, 1)));
    expect(status[1]).toBe(status[0]);
    expect(await paged.getI2sClockPinMode()).toBe(1);
    expect(await paged.getI2sClockPinMode()).toEqual(await legacy.getI2sClockPinMode());
  });

  it('act_addr: saving a preset slot', async () => {
    const { legacy, paged, legacyWire, pagedWire } = await pair(chip);
    const status = await Promise.all([legacyWire, pagedWire].map((w) => proto.actionCmd(w, proto.Act.PresetSave, 2)));
    expect(status[1]).toBe(status[0]);
    const dir = await paged.getPresetDirectory();
    expect(dir.occupiedSlotsSet.has(2 as Domain.PresetSlot)).toBe(true);
    expect(dir).toEqual(await legacy.getPresetDirectory());
  });

  it('act_packed: output type with the slot and value packed in wValue', async () => {
    const { legacy, paged, legacyWire, pagedWire } = await pair(chip);
    const wValue = (1 << 8) | 0;
    const status = await Promise.all([legacyWire, pagedWire].map((w) => proto.actionCmd(w, proto.Act.OutputType, wValue)));
    expect(status[1]).toBe(status[0]);
    expect(await paged.getOutputType(0)).toBe(1);
    expect(await paged.getOutputType(0)).toEqual(await legacy.getOutputType(0));
  });
});
