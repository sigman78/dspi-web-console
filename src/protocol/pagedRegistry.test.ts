// Cross-checks the console's legacy command table against the vendored
// firmware registry (dspi_commands.json) and its 1.1.6 -> 1.1.7 map
// (legacy_map.json). A re-vendor that moves a command the console relies on
// fails here.

import { describe, it, expect } from 'vitest';
import { Codec, type BinCodec } from '@/utils';
import { WireCmd } from './wireCmd';
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

// Console entries with a fixed-size payload whose 1.1.6 opcode took one USB
// direction, and that direction maps one-to-one onto a paged command. Split
// and custom adapters have no single size to compare.
function directOneWay(dir: 'in' | 'out') {
  return Object.entries(WireCmd).flatMap(([name, entry]) => {
    if (!('codec' in entry)) return [];
    const op = OPCODES.get(entry.code);
    const adapter = op?.[dir];
    if (!adapter?.target || adapter.kind !== 'direct' || op?.[dir === 'in' ? 'out' : 'in']) return [];
    const target = paged(adapter.target);
    if (!target) throw new Error(`${name}: legacy_map target ${adapter.target} is not in the registry`);
    return [{ name, size: Codec.sizeOf(entry.codec as BinCodec<unknown>), target }];
  });
}

describe('vendored paged registry', () => {
  it('is the protocol major the console speaks', () => {
    expect(PROTOCOL_MAJOR).toBe(SUPPORTED_PROTOCOL_MAJOR);
  });

  it('maps every console opcode, except the system clock (overclock branch, never in 1.1.6)', () => {
    const unmapped = Object.entries(WireCmd)
      .filter(([, entry]) => !OPCODES.has(entry.code))
      .map(([name]) => name);
    expect(unmapped.sort()).toEqual(['GetSysClock', 'SetSysClock']);
  });

  // The console reads a prefix of some replies the paged firmware grew. The
  // serial is the other way round: the console asks 32 B, SYS.SERIAL answers 16.
  it('fits every direct console read in its paged reply, except the serial', () => {
    const reads = directOneWay('in');
    expect(reads.length).toBeGreaterThan(50);
    const over = reads.filter((r) => typeof r.target.getLen !== 'number' || r.size > r.target.getLen);
    expect(over.map((r) => r.name)).toEqual(['GetSerial']);
  });

  it('fits every direct console write in its paged SET bounds', () => {
    const writes = directOneWay('out');
    expect(writes.length).toBeGreaterThan(50);
    const outside = writes.filter(({ size, target: t }) =>
      !t.set || t.setMin === null || t.setMax === null || size < t.setMin || size > t.setMax);
    expect(outside.map((w) => w.name)).toEqual([]);
  });
});
