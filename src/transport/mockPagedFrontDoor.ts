// Mock of a paged-protocol (fw 1.1.7+) device's USB front door: validates and
// records each request the way vc_usb does, then runs it on the mock's 1.1.6
// handlers through the inverse of the legacy adapter map.

import { TransportStall } from './DspTransport';
import { pagedCommand } from '@/protocol/paged';
import { PagedCmd, VcResult } from '@/protocol/paged.gen';
import { LEGACY_ADAPTERS, StatusFamily, type LegacyAdapter, type LegacyAddr, type LegacyField, type VcByte } from '@/protocol/legacyMap.gen';

const LAST_RESULT = PagedCmd.SYS.LAST_RESULT.id;
const PROTOCOL_INFO = PagedCmd.SYS.PROTOCOL_INFO.id;

export interface LegacyHandlers {
  legacyIn(code: number, wValue: number, length: number): Promise<Uint8Array>;
  legacyOut(code: number, wValue: number, data: Uint8Array): Promise<void>;
  // Closes any open chunk session, as a new SETUP does on the firmware.
  closeChunkSessions(): void;
}

// How to reproduce a paged request as a 1.1.6 one.
interface Route {
  code: number;
  // Legacy wValue for a paged address and (acts) payload value.
  wValue(addr: number, value: number): number;
  trunc?: number;
  act?: keyof typeof StatusFamily;
  overrides?: VcByte[];
  direct: boolean;
}

type RouteKind = 'get' | 'set';

const field = (f: LegacyField, v: number): number => (v & f.mask) << f.shift;

function addrBits(a: LegacyAddr | undefined, addr: number): number {
  if (!a) return addr;
  if ('const' in a) return 0;
  return field(a, addr - a.add);
}

// Registers every paged target an adapter reaches; a split case adds its selector bits to the legacy wValue.
function collect(a: LegacyAdapter | null | undefined, sel: number, kind: RouteKind, code: number, add: (target: number, k: RouteKind, r: Route) => void): void {
  if (!a) return;
  if ('addr' in a && a.addr && 'const' in a.addr && a.addr.const !== 0) throw new Error('mockPagedFrontDoor: non-zero const addr is not modelled');
  if (a.kind === 'split') {
    for (const [c, sub] of Object.entries(a.cases)) {
      collect(sub, sel | field(a.selector, Number(c)), kind, code, add);
    }
    collect(a.default, sel, kind, code, add);
    return;
  }
  if (a.kind === 'custom') return;
  if (a.kind === 'direct') {
    add(a.target, kind, { code, direct: true, trunc: a.trunc, wValue: (addr) => sel | addrBits(a.addr, addr) });
    return;
  }
  const valueField = a.kind === 'act_addr' ? null : a.value;
  const unaddressed = a.kind === 'act_value' && !a.addr;
  add(a.target, 'set', {
    code, direct: false, act: a.status, overrides: a.status_overrides,
    wValue: (addr, value) => sel | (unaddressed ? 0 : addrBits(a.addr, addr)) | (valueField ? field(valueField, value) : 0),
  });
}

const ROUTES = new Map<string, Route>();
for (const op of LEGACY_ADAPTERS) {
  const put = (target: number, kind: RouteKind, route: Route): void => {
    const key = `${target}:${kind}`;
    const have = ROUTES.get(key);
    if (!have || (route.direct && !have.direct)) ROUTES.set(key, route);
  };
  collect(op.in, 0, 'get', op.code, put);
  collect(op.out, 0, 'set', op.code, put);
}

// A write-as-read refusal byte back to the first result code that maps to it.
function vcForStatus(route: Route, status: number): number | null {
  const fam = StatusFamily[route.act!];
  for (const [vc, byte] of [...(route.overrides ?? []), ...fam.fromVc]) if (byte === status) return vc;
  return null;
}

export class MockPagedFrontDoor {
  #last = new Uint8Array(8);
  #injected = new Map<number, { vc: number; times: number }>();

  constructor(private readonly legacy: LegacyHandlers, private readonly protocolInfo: Uint8Array) {}

  // The next `times` requests to `id` STALL with result code `vc`.
  injectRefusal(id: number, vc: number, times = 1): void {
    this.#injected.set(id, { vc, times });
  }

  #record(id: number, dir: 'get' | 'set', vc: number, wValue: number): void {
    const v = new DataView(this.#last.buffer);
    v.setUint16(0, id, true);
    this.#last[2] = dir === 'get' ? 1 : 0;
    this.#last[3] = vc;
    v.setUint16(4, wValue, true);
    v.setUint16(6, 0, true);
  }

  #refuse(id: number, dir: 'get' | 'set', vc: number, wValue: number): never {
    // A GET of LAST_RESULT is never recorded, injected refusals included.
    if (id !== LAST_RESULT || dir !== 'get') this.#record(id, dir, vc, wValue);
    throw new TransportStall(`MockTransport: paged request 0x${id.toString(16)} refused (${vc}) (STALL)`);
  }

  #injectedFor(id: number): number | null {
    const inj = this.#injected.get(id);
    if (!inj || inj.times <= 0) return null;
    inj.times--;
    return inj.vc;
  }

  async ctrlIn(id: number, wValue: number, length: number): Promise<Uint8Array> {
    const cmd = this.#validate(id, 'get', wValue);
    if (id === LAST_RESULT) {
      this.legacy.closeChunkSessions();
      return this.#last.slice(0, length);
    }
    if (id === PROTOCOL_INFO) {
      this.legacy.closeChunkSessions();
      return this.#ok(id, 'get', wValue, this.protocolInfo.slice(0, length));
    }
    const route = ROUTES.get(`${id}:get`);
    if (!route) return this.#refuse(id, 'get', VcResult.VC_ERR_UNSUPPORTED, wValue);
    const want = typeof cmd.getLen === 'number' ? cmd.getLen : length;
    let reply: Uint8Array;
    try {
      reply = await this.legacy.legacyIn(route.code, route.wValue(wValue, 0), want);
    } catch (err) {
      return this.#refuse(id, 'get', this.#vcOf(err), wValue);
    }
    return this.#ok(id, 'get', wValue, reply.slice(0, length));
  }

  async ctrlOut(id: number, wValue: number, data: Uint8Array): Promise<void> {
    this.#validate(id, 'set', wValue, data.length);
    const route = ROUTES.get(`${id}:set`);
    if (!route) return this.#refuse(id, 'set', VcResult.VC_ERR_UNSUPPORTED, wValue);
    let vc: number = VcResult.VC_OK;
    try {
      if (route.act) {
        const status = (await this.legacy.legacyIn(route.code, route.wValue(wValue, data[0] ?? 0), 1))[0];
        if (status !== StatusFamily[route.act].success) vc = vcForStatus(route, status) ?? VcResult.VC_ERR_UNSUPPORTED;
      } else {
        await this.legacy.legacyOut(route.code, route.wValue(wValue, 0), route.trunc ? data.slice(0, route.trunc) : data);
      }
    } catch (err) {
      vc = this.#vcOf(err);
    }
    if (vc !== VcResult.VC_OK) this.#refuse(id, 'set', vc, wValue);
    this.#ok(id, 'set', wValue, undefined);
  }

  #vcOf(err: unknown): number {
    if (err instanceof TransportStall) return VcResult.VC_ERR_UNSUPPORTED;
    throw err;
  }

  #ok<T>(id: number, dir: 'get' | 'set', wValue: number, reply: T): T {
    this.#record(id, dir, VcResult.VC_OK, wValue);
    return reply;
  }

  // vc_check order: unknown, direction, length. The mock stops there: it has
  // no address check. Page 0 is unknown.
  #validate(id: number, dir: 'get' | 'set', wValue: number, length = 0) {
    const injected = this.#injectedFor(id);
    if (injected !== null) this.#refuse(id, dir, injected, wValue);
    const cmd = id > 0xFF ? pagedCommand(id) : undefined;
    if (!cmd) this.#refuse(id, dir, VcResult.VC_ERR_UNKNOWN, wValue);
    if (!(dir === 'get' ? cmd.get : cmd.set)) this.#refuse(id, dir, VcResult.VC_ERR_DIRECTION, wValue);
    if (dir === 'set') {
      const bulk = cmd.setMin === null;
      if (bulk ? length === 0 : length < cmd.setMin! || length > cmd.setMax!) this.#refuse(id, dir, VcResult.VC_ERR_LENGTH, wValue);
    }
    return cmd;
  }
}
