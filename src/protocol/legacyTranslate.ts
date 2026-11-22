// Forward translation of a 1.1.6 request into the paged commands that do the
// same on firmware 1.1.7+, driven by the generated legacy map. The mock's
// front door (transport/mockPagedFrontDoor.ts) applies the inverse.
//
// Deviation from the map: 1.1.6 ACKed a rejected OUT (the default out_stall) and
// swallowed a split's null case; here both stay refusals (CommandRefused,
// UntranslatedCommand), which link health ignores and the caller can see.
// Entries marked out_stall: 'raise' already behave that way and need no code.

import { RefusedError, type DspTransport } from '@/transport/DspTransport';
import { GenerationRefusal } from '@/transport/withGenerationGuard';
import { pagedGet, pagedSet, pagedAction, CommandRefused, type ExclusiveTransport } from './pagedExec';
import { VcResult } from './paged.gen';
import * as LegacyMap from './legacyMap.gen';

export type LegacyDir = 'in' | 'out';

// The legacy request has no paged equivalent: a custom or retired opcode, an
// opcode the map does not list, or a selector the 1.1.6 firmware refused.
export class UntranslatedCommand extends RefusedError {
  constructor(readonly code: number, readonly dir: LegacyDir) {
    super(`legacy opcode 0x${code.toString(16).padStart(2, '0')} (${dir === 'in' ? 'IN' : 'OUT'}) has no paged translation`);
    this.name = 'UntranslatedCommand';
  }
}

// A map entry: an adapter, or null when the opcode and direction are not listed.
const ROUTES = new Map<string, LegacyMap.LegacyAdapter | null>();
for (const op of LegacyMap.LEGACY_ADAPTERS) {
  if (op.in) ROUTES.set(`${op.code}:in`, op.in);
  if (op.out) ROUTES.set(`${op.code}:out`, op.out);
}

// A leaf adapter of the map: what remains once splits are resolved.
type Leaf = Exclude<LegacyMap.LegacyAdapter, { kind: 'split' } | { kind: 'custom' }>;

const bits = (f: LegacyMap.LegacyField, wValue: number): number => (wValue >> f.shift) & f.mask;

function address(a: LegacyMap.LegacyAddr | undefined, wValue: number): number {
  if (!a) return wValue;
  if ('const' in a) return a.const;
  return bits(a, wValue) + a.add;
}

// Split selectors pick a case by the legacy wValue; unlisted values take the
// default. A null case or default is a selector 1.1.6 refused.
function resolve(code: number, dir: LegacyDir, wValue: number): Leaf {
  let a: LegacyMap.LegacyAdapter | null | undefined = ROUTES.get(`${code}:${dir}`);
  while (a && a.kind === 'split') {
    const sel = bits(a.selector, wValue);
    a = Object.hasOwn(a.cases, sel) ? a.cases[sel] : a.default;
  }
  if (!a || a.kind === 'custom') throw new UntranslatedCommand(code, dir);
  return a;
}

function encode(how: LegacyMap.LegacyEncode, v: number): number {
  switch (how) {
    case 'u8': return v & 0xFF;
    case 'u8_sat': return Math.min(v, 0xFF);
    case 'bool': return v === 0 ? 0 : 1;
  }
}

// Runs a legacy request on the paged commands. `t` is held for the whole call,
// so the request, any LAST_RESULT read and BUSY resends stay one unit.
export async function translateLegacy(
  t: ExclusiveTransport, code: number, dir: 'in', wValue: number, length: number,
): Promise<Uint8Array>;
export async function translateLegacy(
  t: ExclusiveTransport, code: number, dir: 'out', wValue: number, data: Uint8Array,
): Promise<void>;
export async function translateLegacy(
  t: ExclusiveTransport, code: number, dir: LegacyDir, wValue: number, arg: number | Uint8Array,
): Promise<Uint8Array | void> {
  const a = resolve(code, dir, wValue);
  switch (a.kind) {
    case 'direct':
      if (dir === 'in') return getOrFill(t, a, wValue, arg as number);
      return pagedSet(t, a.target, address(a.addr, wValue), a.trunc !== undefined ? (arg as Uint8Array).slice(0, a.trunc) : arg as Uint8Array);
    case 'act_value':
    case 'act_packed': {
      const data = Uint8Array.of(encode(a.encode, bits(a.value, wValue)));
      return act(t, a.target, address(a.kind === 'act_value' && !a.addr ? { const: 0 } : a.addr, wValue), data, a.status, a.status_overrides);
    }
    case 'act_addr':
      return act(t, a.target, address(a.addr, wValue), new Uint8Array(0), a.status, a.status_overrides);
  }
}

// A GET the device refuses with a code the map lists answers fill bytes, as 1.1.6
// did. A command the connected device does not list never reaches the wire and
// counts as VC_ERR_UNKNOWN.
async function getOrFill(
  t: ExclusiveTransport, a: Extract<Leaf, { kind: 'direct' }>, wValue: number, length: number,
): Promise<Uint8Array> {
  try {
    return await pagedGet(t, a.target, address(a.addr, wValue), length);
  } catch (err) {
    const codes = a.on_stall?.codes;
    const vc = err instanceof CommandRefused ? err.vc
      : err instanceof GenerationRefusal && err.generation === 'paged' ? VcResult.VC_ERR_UNKNOWN
        : null;
    if (!a.on_stall || !codes || vc === null || !codes.includes(vc)) throw err;
    return new Uint8Array(Math.min(a.on_stall.len, length)).fill(a.on_stall.fill);
  }
}

async function act(
  t: ExclusiveTransport, id: number, wValue: number, data: Uint8Array, family: LegacyMap.LegacyStatusFamily, overrides: LegacyMap.VcByte[] | undefined,
): Promise<Uint8Array> {
  return Uint8Array.of(await pagedAction(t, id, wValue, data, family, { statusOverrides: overrides }));
}

// Transport form: `inner` carries paged requests, `t` is its in-slot executor.
export function translatingTransport(inner: DspTransport): Pick<DspTransport, 'ctrlIn' | 'ctrlOut'> {
  const t: ExclusiveTransport = { exclusive: (fn) => fn(inner) };
  return {
    ctrlIn: (cmd, value, length) => translateLegacy(t, cmd, 'in', value, length),
    ctrlOut: (cmd, value, data) => translateLegacy(t, cmd, 'out', value, data),
  };
}
