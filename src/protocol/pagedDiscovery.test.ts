import { describe, it, expect } from 'vitest';
import { PagedCmd, PagedPage, VcResult } from './paged.gen';
import { allPagedCommands } from './paged';
import * as Discovery from './pagedDiscovery';
import { parseProtocolInfo } from './protocolInfo';
import { MockTransport } from '@/transport/MockTransport';
import { TransportStall } from '@/transport/DspTransport';

const FILTER = PagedPage.FILTER.page;
const FILTER_IDS = [0x0610, 0x0611, 0x0612];
const RP2350 = 1;
const RP2040 = 0;

function exclusive(t: MockTransport) {
  return { exclusive: <T>(fn: (raw: MockTransport) => Promise<T>) => fn(t) };
}

function allPages(): Map<number, number> {
  return new Map(Object.values(PagedPage).map((p) => [p.page, p.revision]));
}

function ids(dir: 'get' | 'set'): number[] {
  return [...allPagedCommands()].filter((c) => c[dir]).map((c) => c.id);
}

describe('paged discovery parsing', () => {
  it('decodes the GET and SET bitmaps of the FILTER page', () => {
    const bytes = new Uint8Array(64);
    bytes[2] = 0x07;
    bytes[34] = 0x07;
    expect(Discovery.parseCommandBitmaps(FILTER, bytes)).toEqual({ get: FILTER_IDS, set: FILTER_IDS });
  });

  it('keeps GET and SET apart', () => {
    const bytes = new Uint8Array(64);
    bytes[0] = 0x01;        // GET 0
    bytes[32 + 31] = 0x80;  // SET 0xFF
    expect(Discovery.parseCommandBitmaps(0x09, bytes)).toEqual({ get: [0x0900], set: [0x09FF] });
  });

  it('decodes PAGE_LIST pairs', () => {
    expect(Discovery.parsePageList(new Uint8Array([0x01, 1, 0x02, 3, 0x06, 1])))
      .toEqual([{ page: 1, revision: 1 }, { page: 2, revision: 3 }, { page: 6, revision: 1 }]);
  });

  it('reads the full PROTOCOL_INFO and rejects a wrong magic', () => {
    const bytes = new Uint8Array([0x44, 0x53, 0x50, 0x69, 1, 2, 12, 0, 0x40, 0x00, 0x00, 0x01, 0, 0, 0, 0]);
    expect(parseProtocolInfo(bytes)).toEqual({ major: 1, minor: 2, pageCount: 12, maxSet: 64, maxGet: 256 });
    expect(parseProtocolInfo(new Uint8Array(16))).toBeNull();
  });
});

describe('PagedCatalog drift', () => {
  it('is clean when the device matches the registry', () => {
    const c = Discovery.catalogFrom(allPages(), ids('get'), ids('set'), RP2350);
    expect(c.drift).toEqual({ unknownToConsole: [], missingOnDevice: [], revisionMismatch: [] });
  });

  it('reports a registry command the device lacks, and an id the console does not know', () => {
    const get = ids('get').filter((id) => id !== PagedCmd.FX.TUBE_ENABLE.id).concat(0x08EE);
    const c = Discovery.catalogFrom(allPages(), get, ids('set'), RP2350);
    expect(c.drift.missingOnDevice).toContain(PagedCmd.FX.TUBE_ENABLE.id);
    expect(c.drift.unknownToConsole).toEqual([0x08EE]);
    expect(c.has(PagedCmd.FX.TUBE_ENABLE.id, 'get')).toBe(false);
    expect(c.has(PagedCmd.FX.TUBE_ENABLE.id, 'set')).toBe(true);
  });

  it('does not count RP2350-only commands as missing on an RP2040', () => {
    const gated = [...allPagedCommands()].filter((c) => c.build === 'PICO_RP2350').map((c) => c.id);
    expect(gated.length).toBeGreaterThan(0);
    const get = ids('get').filter((id) => !gated.includes(id));
    const set = ids('set').filter((id) => !gated.includes(id));
    expect(Discovery.catalogFrom(allPages(), get, set, RP2040).drift.missingOnDevice).toEqual([]);
    expect(Discovery.catalogFrom(allPages(), get, set, RP2350).drift.missingOnDevice).toEqual(expect.arrayContaining(gated));
  });

  it('ignores pages the device does not list and flags revision differences', () => {
    const pages = allPages();
    pages.delete(PagedPage.CS.page);
    pages.set(PagedPage.FX.page, 9);
    const get = ids('get').filter((id) => id >> 8 !== PagedPage.CS.page);
    const set = ids('set').filter((id) => id >> 8 !== PagedPage.CS.page);
    const c = Discovery.catalogFrom(pages, get, set, RP2350);
    expect(c.drift.missingOnDevice).toEqual([]);
    expect(c.drift.revisionMismatch).toEqual([{ page: PagedPage.FX.page, device: 9, console: PagedPage.FX.revision }]);
  });
});

describe('discoverPaged against the mock device', () => {
  async function discover(platform: 'rp2350' | 'rp2040') {
    const t = new MockTransport({ platform, paged: true });
    await t.open();
    const info = parseProtocolInfo(await t.ctrlIn(PagedCmd.SYS.PROTOCOL_INFO.id, 0, 16))!;
    return Discovery.discoverPaged(exclusive(t), info, platform === 'rp2350' ? RP2350 : RP2040);
  }

  it('lists every release page without DIAG, and no drift, on an RP2350', async () => {
    const c = await discover('rp2350');
    expect(c.pages.has(PagedPage.DIAG.page)).toBe(false);
    expect(c.pages.size).toBe(Object.keys(PagedPage).length - 1);
    expect(c.has(PagedCmd.FX.UPMIX_CONFIG.id, 'get')).toBe(true);
    expect(c.drift).toEqual({ unknownToConsole: [], missingOnDevice: [], revisionMismatch: [] });
  });

  it('omits RP2350-only commands on an RP2040 without reporting drift', async () => {
    const c = await discover('rp2040');
    expect(c.has(PagedCmd.FX.UPMIX_CONFIG.id, 'get')).toBe(false);
    expect(c.has(PagedCmd.INPUT.ADAT_RX_ENABLE.id, 'get')).toBe(false);
    expect(c.has(PagedCmd.FX.TUBE_ENABLE.id, 'get')).toBe(true);
    expect(c.drift.missingOnDevice).toEqual([]);
  });

  it('refuses PAGE_COMMANDS for a page the device does not have', async () => {
    const t = new MockTransport({ platform: 'rp2350', paged: true });
    await t.open();
    await expect(t.ctrlIn(PagedCmd.SYS.PAGE_COMMANDS.id, PagedPage.DIAG.page, 64)).rejects.toBeInstanceOf(TransportStall);
    const rec = await t.ctrlIn(PagedCmd.SYS.LAST_RESULT.id, 0, 8);
    expect(rec[3]).toBe(VcResult.VC_ERR_ADDRESS);
  });

  it('treats a listed page that the device then refuses as absent', async () => {
    const t = new MockTransport({ platform: 'rp2350', paged: true });
    await t.open();
    t.injectRefusal(PagedCmd.SYS.PAGE_COMMANDS.id, VcResult.VC_ERR_ADDRESS, 1);
    const info = parseProtocolInfo(await t.ctrlIn(PagedCmd.SYS.PROTOCOL_INFO.id, 0, 16))!;
    const c = await Discovery.discoverPaged(exclusive(t), info, RP2350);
    // The first listed page (SYS) was refused; the rest survive.
    expect(c.pages.has(PagedPage.SYS.page)).toBe(false);
    expect(c.pages.has(PagedPage.STORE.page)).toBe(true);
  });
});
