// Paged-protocol discovery: which pages and commands this device implements.
// SYS.PAGE_LIST names the pages (with revisions); SYS.PAGE_COMMANDS gives one
// GET/SET bitmap per page. The catalog is compared with the console's vendored
// registry so version drift is visible, and it gates the paged requests the
// connection will send.

import { PagedCmd, PagedPage, VcResult } from './paged.gen';
import { pagedCommand, allPagedCommands } from './paged';
import { CommandRefused, pagedGet, type ExclusiveTransport } from './pagedExec';
import type { ProtocolInfo } from './protocolInfo';

const PAGE_LIST = PagedCmd.SYS.PAGE_LIST.id;
const PAGE_COMMANDS = PagedCmd.SYS.PAGE_COMMANDS.id;
const BITMAP_BYTES = 32;

// Firmware platform id of the RP2350 (GetPlatform byte 0).
const PLATFORM_RP2350 = 1;

export interface PageEntry { page: number; revision: number }

// SYS.PAGE_LIST reply: {page, revision} pairs, ascending.
export function parsePageList(bytes: Uint8Array): PageEntry[] {
  const out: PageEntry[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) out.push({ page: bytes[i], revision: bytes[i + 1] });
  return out;
}

// Command ids implemented on `page`, per direction, from a 64-byte
// SYS.PAGE_COMMANDS reply: command n has GET iff bit (n & 7) of byte (n >> 3),
// SET iff the same bit of byte 32 + (n >> 3).
export function parseCommandBitmaps(page: number, bytes: Uint8Array): { get: number[]; set: number[] } {
  const get: number[] = [];
  const set: number[] = [];
  for (let n = 0; n < 256; n++) {
    const bit = 1 << (n & 7);
    if (((bytes[n >> 3] ?? 0) & bit) !== 0) get.push((page << 8) | n);
    if (((bytes[BITMAP_BYTES + (n >> 3)] ?? 0) & bit) !== 0) set.push((page << 8) | n);
  }
  return { get, set };
}

export interface PagedDrift {
  // Ids the device implements that the console's registry lacks.
  readonly unknownToConsole: readonly number[];
  // Registry ids the device lacks, on pages it lists, ignoring commands whose
  // build condition this platform does not meet.
  readonly missingOnDevice: readonly number[];
  // Pages whose revision differs from the console's.
  readonly revisionMismatch: readonly { page: number; device: number; console: number }[];
}

export interface PagedCatalog {
  // Page number to revision, for pages the device lists.
  readonly pages: ReadonlyMap<number, number>;
  has(id: number, dir: 'get' | 'set'): boolean;
  readonly drift: PagedDrift;
}

function buildCatalog(
  pages: ReadonlyMap<number, number>,
  get: ReadonlySet<number>,
  set: ReadonlySet<number>,
  platformId: number,
): PagedCatalog {
  const device = new Set([...get, ...set]);

  const unknownToConsole = [...device].filter((id) => pagedCommand(id) === undefined).sort((a, b) => a - b);

  const missingOnDevice: number[] = [];
  for (const cmd of allPagedCommands()) {
    if (!pages.has(cmd.id >> 8)) continue;
    // Only a build the device's own platform contains can be missing.
    if (cmd.build !== null && !(cmd.build === 'PICO_RP2350' && platformId === PLATFORM_RP2350)) continue;
    if ((cmd.get && !get.has(cmd.id)) || (cmd.set && !set.has(cmd.id))) missingOnDevice.push(cmd.id);
  }

  const revisionMismatch: { page: number; device: number; console: number }[] = [];
  for (const known of Object.values(PagedPage)) {
    const rev = pages.get(known.page);
    if (rev !== undefined && rev !== known.revision) {
      revisionMismatch.push({ page: known.page, device: rev, console: known.revision });
    }
  }

  return {
    pages,
    has: (id, dir) => (dir === 'get' ? get : set).has(id),
    drift: { unknownToConsole, missingOnDevice, revisionMismatch },
  };
}

// Reads PAGE_LIST and every listed page's command bitmaps. A page the device
// lists but then refuses with VC_ERR_ADDRESS counts as absent.
export async function discoverPaged(t: ExclusiveTransport, info: ProtocolInfo, platformId: number): Promise<PagedCatalog> {
  const listed = parsePageList(await pagedGet(t, PAGE_LIST, 0, 2 * info.pageCount));
  const pages = new Map<number, number>();
  const get = new Set<number>();
  const set = new Set<number>();
  for (const { page, revision } of listed) {
    let bitmap: Uint8Array;
    try {
      bitmap = await pagedGet(t, PAGE_COMMANDS, page, 2 * BITMAP_BYTES);
    } catch (err) {
      if (err instanceof CommandRefused && err.vc === VcResult.VC_ERR_ADDRESS) continue;
      throw err;
    }
    pages.set(page, revision);
    const cmds = parseCommandBitmaps(page, bitmap);
    for (const id of cmds.get) get.add(id);
    for (const id of cmds.set) set.add(id);
  }
  return buildCatalog(pages, get, set, platformId);
}

// For tests and the mock: a catalog built from explicit sets.
export function catalogFrom(
  pages: ReadonlyMap<number, number>, get: Iterable<number>, set: Iterable<number>, platformId: number,
): PagedCatalog {
  return buildCatalog(pages, new Set(get), new Set(set), platformId);
}
