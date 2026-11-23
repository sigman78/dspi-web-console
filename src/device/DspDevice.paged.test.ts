import { describe, it, expect } from 'vitest';
import { DspDevice, UnsupportedFirmware, type DspDeviceInfo } from './DspDevice';
import { withGenerationGuard, GenerationRefusal } from '@/transport/withGenerationGuard';
import { withSerializedCtrl, type SerializedDspTransport } from '@/transport/withSerializedCtrl';
import { MockTransport } from '@/transport/MockTransport';
import { resolveMockProfile } from '@/mockProfiles';
import { PagedCmd } from '@/protocol/paged.gen';
import { buildBulkParams } from '@/protocol';
import type { DspTransport } from '@/transport/DspTransport';

function pagedMock(chip: 'rp2350' | 'rp2040'): MockTransport {
  const profile = resolveMockProfile('v34', chip);
  return new MockTransport({ platform: profile.platform, ...profile.opts });
}

function recording(inner: DspTransport): { transport: DspTransport; ins: number[] } {
  const ins: number[] = [];
  const transport: DspTransport = {
    open: () => inner.open(),
    close: () => inner.close(),
    isOpen: () => inner.isOpen(),
    on: (event, listener) => inner.on(event, listener),
    ctrlIn: (cmd, value, length) => { ins.push(cmd); return inner.ctrlIn(cmd, value, length); },
    ctrlOut: (cmd, value, data) => inner.ctrlOut(cmd, value, data),
  };
  return { transport, ins };
}

// Connects the way DspDevice.create does, but keeps the guarded transport reachable.
class Exposed extends DspDevice {
  static async connect(inner: DspTransport): Promise<Exposed> {
    const guarded = withGenerationGuard(inner);
    const serialized = withSerializedCtrl(guarded);
    const info: DspDeviceInfo = await Exposed.resolveInfo(serialized, guarded);
    return new Exposed(serialized, info);
  }
  get wire(): SerializedDspTransport { return this.transport; }
}

describe('paged connect', () => {
  it('connects read-only to an RP2350 with the full catalog', async () => {
    const dev = await DspDevice.create(pagedMock('rp2350'));
    const caps = dev.capabilities;
    expect(dev.generation).toBe('paged');
    expect([caps.support, caps.wire, caps.fwLabel]).toEqual(['supported', 34, '1.1.7 beta 1']);
    expect(caps.catalog?.drift).toEqual({ unknownToConsole: [], missingOnDevice: [], revisionMismatch: [] });
    expect(caps.features).toMatchObject({ adatInput: true, adatOutput: true, upmix: true, psybass: true, limiter: true, rta: true, buildStamp: true });
    expect(dev.info.serial).toBe('MOCK-RP2350-0001');
    expect(dev.info.build?.describe).not.toBe('');
  });

  it('reads the snapshot through the chunked paged bulk read', async () => {
    const { transport, ins } = recording(pagedMock('rp2350'));
    const dev = await DspDevice.create(transport);
    const snap = await dev.getSnapshot();
    expect(snap.channels.length).toBeGreaterThan(0);
    expect(ins).toContain(PagedCmd.STORE.ALL_PARAMS_CHUNK.id);
    expect(dev.lastRawBulk?.length).toBe(6136);
  });

  it('takes the RP2350-only features from the device bitmap on an RP2040', async () => {
    const dev = await DspDevice.create(pagedMock('rp2040'));
    expect(dev.capabilities.features).toMatchObject({ adatInput: false, adatOutput: false, upmix: false, psybass: false, tube: true, limiter: true });
    expect(dev.capabilities.catalog?.drift.missingOnDevice).toEqual([]);
    const snap = await dev.getSnapshot();
    expect(snap.channels.length).toBeGreaterThan(0);
  });

  it('drops a feature whose command the device does not list', async () => {
    const inner = pagedMock('rp2350');
    // Hide the tube command's GET bit in the SYS-independent FX page bitmap.
    const bitmapReply = async (page: number, length: number): Promise<Uint8Array> => {
      const bytes = await inner.ctrlIn(PagedCmd.SYS.PAGE_COMMANDS.id, page, length);
      if (page === PagedCmd.FX.TUBE_ENABLE.id >> 8) {
        const n = PagedCmd.FX.TUBE_ENABLE.id & 0xFF;
        bytes[n >> 3] &= ~(1 << (n & 7));
      }
      return bytes;
    };
    const t: DspTransport = {
      open: () => inner.open(), close: () => inner.close(), isOpen: () => inner.isOpen(), on: (e, l) => inner.on(e, l),
      ctrlIn: (cmd, value, length) => cmd === PagedCmd.SYS.PAGE_COMMANDS.id ? bitmapReply(value, length) : inner.ctrlIn(cmd, value, length),
      ctrlOut: (cmd, value, data) => inner.ctrlOut(cmd, value, data),
    };
    const dev = await DspDevice.create(t);
    expect(dev.capabilities.features.tube).toBe(false);
    expect(dev.capabilities.catalog?.drift.missingOnDevice).toEqual([PagedCmd.FX.TUBE_ENABLE.id]);
  });

  it('pings by reading the platform', async () => {
    const { transport, ins } = recording(pagedMock('rp2350'));
    const dev = await DspDevice.create(transport);
    ins.length = 0;
    await dev.ping();
    expect(ins).toEqual([PagedCmd.SYS.PLATFORM.id]);
  });

  it('a legacy device pings with its old read and reports the legacy generation', async () => {
    const dev = await DspDevice.create(new MockTransport({ platform: 'rp2350' }));
    expect([dev.generation, dev.capabilities.catalog]).toEqual(['legacy', null]);
    await expect(dev.ping()).resolves.toBeUndefined();
  });

  it('lets a paged SET the device lists through and refuses one it does not list', async () => {
    const inner = pagedMock('rp2350');
    const tube = PagedCmd.FX.TUBE_ENABLE;
    // Hide only the tube command's SET bit in the FX page bitmap.
    const bitmapReply = async (page: number, length: number): Promise<Uint8Array> => {
      const bytes = await inner.ctrlIn(PagedCmd.SYS.PAGE_COMMANDS.id, page, length);
      if (page === tube.id >> 8) bytes[32 + ((tube.id & 0xFF) >> 3)] &= ~(1 << (tube.id & 7));
      return bytes;
    };
    const { transport, ins } = recording({
      open: () => inner.open(), close: () => inner.close(), isOpen: () => inner.isOpen(), on: (e, l) => inner.on(e, l),
      ctrlIn: (cmd, value, length) => cmd === PagedCmd.SYS.PAGE_COMMANDS.id ? bitmapReply(value, length) : inner.ctrlIn(cmd, value, length),
      ctrlOut: (cmd, value, data) => inner.ctrlOut(cmd, value, data),
    });
    let outs = 0;
    const counted: DspTransport = { ...transport, ctrlOut: (c, v, d) => { outs++; return transport.ctrlOut(c, v, d); } };
    const dev = await Exposed.connect(counted);
    expect(dev.capabilities.catalog?.has(tube.id, 'set')).toBe(false);
    await expect(dev.wire.ctrlOut(tube.id, 0, new Uint8Array(tube.setMin!))).rejects.toBeInstanceOf(GenerationRefusal);
    expect(outs).toBe(0);
    // A SET the device lists reaches it, and so does a listed GET.
    const gain = PagedCmd.ROUTE.OUTPUT_GAIN;
    expect(dev.capabilities.catalog?.has(gain.id, 'set')).toBe(true);
    await dev.wire.ctrlOut(gain.id, 0, new Uint8Array(gain.setMin!));
    expect(outs).toBe(1);
    await dev.wire.ctrlIn(PagedCmd.SYS.PLATFORM.id, 0, PagedCmd.SYS.PLATFORM.getLen);
    expect(ins).toContain(PagedCmd.SYS.PLATFORM.id);
  });

  it.each([32, 33])('refuses a paged device reporting wire V%i', async (wireVersion) => {
    const profile = resolveMockProfile('v34', 'rp2350');
    const t = new MockTransport({ platform: profile.platform, ...profile.opts, wireVersion });
    await expect(DspDevice.create(t)).rejects.toBeInstanceOf(UnsupportedFirmware);
  });
});

describe('paged V36 bulk', () => {
  const newest = (chip: 'rp2350' | 'rp2040') => {
    const profile = resolveMockProfile('paged', chip);
    return new MockTransport({ platform: profile.platform, ...profile.opts });
  };

  it('is the newest wire by default and round-trips the upmixer v2 and spatializer sections', async () => {
    const dev = await DspDevice.create(newest('rp2350'));
    expect(dev.capabilities).toMatchObject({ wire: 36, support: 'supported' });
    expect(dev.capabilities.features.upmixRoutes).toBe(true);
    const bulk = await dev.getAllParams();
    bulk.spatial = { ...bulk.spatial, enabled: true, widthPct: 80 };
    bulk.upmix2.p0Ext.routes[2] = { outMask: 6, trimQ1: -4, flags: 1 };
    await dev.setAllParams(bulk);
    const snap = await dev.getSnapshot();
    expect(snap.spatial).toMatchObject({ enabled: true, widthPct: 80 });
    expect(snap.upmix2.p0Ext.routes[2]).toEqual({ outMask: 6, trimQ1: -4, flags: 1 });
  });

  it('reports the upmixer v2 section zeroed on an RP2040 and keeps ignoring writes to it', async () => {
    const dev = await DspDevice.create(newest('rp2040'));
    expect(dev.capabilities.features.upmixRoutes).toBe(false);
    const bulk = await dev.getAllParams();
    expect(bulk.upmix2.p0Ext.activeCounts).toBe(0);
    bulk.upmix2.p0Ext.activeCounts = 3;
    await dev.setAllParams(bulk);
    expect((await dev.getAllParams()).upmix2.p0Ext.activeCounts).toBe(0);
  });

  it('refuses a complete bulk carrying another version byte', async () => {
    const dev = await Exposed.connect(newest('rp2350'));
    const bulk = await dev.getAllParams();
    const wrongVersion = buildBulkParams(bulk);
    wrongVersion[0] = 35;
    await expect(dev.wire.ctrlOut(PagedCmd.STORE.ALL_PARAMS_CHUNK.id, 0, wrongVersion)).rejects.toThrow();
  });
});

describe('paged V36 upmixer status', () => {
  it('follows the firmware selection: disabled, no profile for the input, nothing routed, active', async () => {
    const profile = resolveMockProfile('paged', 'rp2350');
    const dev = await DspDevice.create(new MockTransport({ platform: profile.platform, ...profile.opts }));
    const reason = async () => (await dev.getUpmixStatus()).parkedReason;
    expect(await reason()).toBe(1);

    const bulk = await dev.getAllParams();
    bulk.upmix2.p1.enabled = true;
    bulk.upmix2.p1Ext.activeCounts = 0b10;          // serves 4 channels, input is stereo
    await dev.setAllParams(bulk);
    expect(await reason()).toBe(2);

    bulk.upmix2.p1Ext.activeCounts = 0b01;
    await dev.setAllParams(bulk);
    expect(await reason()).toBe(6);

    bulk.upmix2.p1Ext.routes[2].outMask = 0b1;
    await dev.setAllParams(bulk);
    expect(await reason()).toBe(0);
  });
});
