// Cross-checks the console's legacy command table against the vendored
// firmware registry (dspi_commands.json) and its 1.1.6 -> 1.1.7 map
// (legacy_map.json). A re-vendor that moves a command the console relies on
// fails here.

import { describe, it, expect } from 'vitest';
import { Codec, type BinCodec } from '@/utils';
import { Cmd, Act } from './commands';
import { PagedCmd, PROTOCOL_MAJOR, type PagedCommand } from './paged.gen';
import { SUPPORTED_PROTOCOL_MAJOR } from './protocolInfo';
import legacyMap from './vendor/legacy_map.json';

interface Adapter { kind: string; target?: string }
interface Opcode { code: number; in?: Adapter; out?: Adapter }

const OPCODES = new Map<number, Opcode>(
  Object.values(legacyMap.opcodes as Record<string, Opcode>).map((op) => [op.code, op]),
);

function paged(target: string): PagedCommand | undefined {
  const [page, name] = target.split('.');
  return (PagedCmd as Record<string, Record<string, PagedCommand>>)[page]?.[name];
}

interface LegacyItem { name: string; code: number; dir: 'in' | 'out'; codec?: BinCodec<unknown> }

// One item per legacy opcode and USB direction: a Cmd get is control-IN, a Cmd
// set control-OUT, an Act control-IN.
function legacyItems(): LegacyItem[] {
  const items: LegacyItem[] = [];
  for (const [name, entry] of Object.entries(Cmd)) {
    const codec = 'codec' in entry ? (entry.codec as BinCodec<unknown>) : undefined;
    const { get, set } = entry.legacy as { get?: number; set?: number };
    if (get !== undefined) items.push({ name, code: get, dir: 'in', codec });
    if (set !== undefined) items.push({ name, code: set, dir: 'out', codec });
  }
  for (const [name, entry] of Object.entries(Act)) items.push({ name, code: entry.legacy.code, dir: 'in' });
  return items;
}

// Console entries with a fixed-size payload whose 1.1.6 opcode took one USB
// direction, and that direction maps one-to-one onto a paged command. Split
// and custom adapters have no single size to compare.
function directOneWay(dir: 'in' | 'out') {
  return legacyItems().flatMap(({ name, code, dir: itemDir, codec }) => {
    if (itemDir !== dir || !codec) return [];
    const op = OPCODES.get(code);
    const adapter = op?.[dir];
    if (!adapter?.target || adapter.kind !== 'direct' || op?.[dir === 'in' ? 'out' : 'in']) return [];
    const target = paged(adapter.target);
    if (!target) throw new Error(`${name}: legacy_map target ${adapter.target} is not in the registry`);
    return [{ name, size: Codec.sizeOf(codec), target }];
  });
}

describe('vendored paged registry', () => {
  it('is the protocol major the console speaks', () => {
    expect(PROTOCOL_MAJOR).toBe(SUPPORTED_PROTOCOL_MAJOR);
  });

  it('maps every console opcode, except the system clock (overclock branch, never in 1.1.6)', () => {
    const unmapped = legacyItems().filter((i) => !OPCODES.has(i.code)).map((i) => i.name);
    expect([...new Set(unmapped)].sort()).toEqual(['SysClock', 'SysClockStatus']);
  });

  // The console reads a prefix of some replies the paged firmware grew. The
  // serial is the other way round: the console asks 32 B, SYS.SERIAL answers 16.
  it('fits every direct console read in its paged reply, except the serial', () => {
    const reads = directOneWay('in');
    expect(reads.length).toBeGreaterThan(50);
    const over = reads.filter((r) => typeof r.target.getLen !== 'number' || r.size > r.target.getLen);
    expect(over.map((r) => r.name)).toEqual(['Serial']);
  });

  it('fits every direct console write in its paged SET bounds', () => {
    const writes = directOneWay('out');
    expect(writes.length).toBeGreaterThan(50);
    const outside = writes.filter(({ size, target: t }) =>
      !t.set || t.setMin === null || t.setMax === null || size < t.setMin || size > t.setMax);
    expect(outside.map((w) => w.name)).toEqual([]);
  });

  // A logical command's get and set opcodes must land on the same paged command.
  it('pairs the get and set of a logical command on one paged command', () => {
    const split: string[] = [];
    let checked = 0;
    for (const [name, entry] of Object.entries(Cmd)) {
      const { get, set } = entry.legacy as { get?: number; set?: number };
      if (get === undefined || set === undefined || get === set) continue;
      const inTarget = OPCODES.get(get)?.in?.target;
      const outTarget = OPCODES.get(set)?.out?.target;
      if (!inTarget || !outTarget) continue;
      checked++;
      if (inTarget !== outTarget) split.push(name);
    }
    expect(checked).toBeGreaterThan(40);
    expect(split.sort()).toEqual([]);
  });
});
