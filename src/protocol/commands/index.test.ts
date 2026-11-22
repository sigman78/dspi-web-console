import { describe, it, expect } from 'vitest';
import { Cmd, Act } from './index';
import { SysCmd, SysAct } from './sys';
import { StoreCmd, StoreAct } from './store';
import { InputCmd, InputAct } from './input';
import { OutputCmd, OutputAct } from './output';
import { RouteCmd, RouteAct } from './route';
import { FilterCmd } from './filter';
import { DynCmd } from './dyn';
import { FxCmd } from './fx';
import { MeasCmd, MeasAct } from './meas';
import { CsCmd, CsAct } from './cs';
import { XportCmd } from './xport';
import { ClockCmd, ClockAct } from './clock';

describe('command tables', () => {
  // Object spread silently drops a name defined in two area files.
  it('merges the area tables without losing entries', () => {
    const cmdAreas = [SysCmd, StoreCmd, InputCmd, OutputCmd, RouteCmd, FilterCmd, DynCmd, FxCmd, MeasCmd, CsCmd, XportCmd, ClockCmd];
    const actAreas = [SysAct, StoreAct, InputAct, OutputAct, RouteAct, MeasAct, CsAct, ClockAct];
    expect(Object.keys(Cmd).length).toBe(cmdAreas.reduce((n, t) => n + Object.keys(t).length, 0));
    expect(Object.keys(Act).length).toBe(actAreas.reduce((n, t) => n + Object.keys(t).length, 0));
  });

  it('assigns every legacy opcode to one command per USB direction', () => {
    const seen = new Map<string, string>();
    const claim = (dir: 'in' | 'out', code: number, name: string) => {
      const key = `${dir}:0x${code.toString(16)}`;
      expect(seen.get(key), `${key} used by ${seen.get(key)} and ${name}`).toBeUndefined();
      seen.set(key, name);
    };
    for (const [name, c] of Object.entries(Cmd)) {
      const { get, set } = c.legacy as { get?: number; set?: number };
      if (get !== undefined) claim('in', get, `Cmd.${name}`);
      if (set !== undefined) claim('out', set, `Cmd.${name}`);
    }
    for (const [name, a] of Object.entries(Act)) claim('in', a.legacy.code, `Act.${name}`);
  });

  // The wire monitor names a frame by opcode alone, so a shared opcode must be
  // one logical command.
  it('lets an opcode appear in several places only within one Cmd entry', () => {
    const owners = new Map<number, string[]>();
    const add = (code: number, owner: string) => owners.set(code, [...(owners.get(code) ?? []), owner]);
    for (const [name, c] of Object.entries(Cmd)) {
      const { get, set } = c.legacy as { get?: number; set?: number };
      if (get !== undefined) add(get, `Cmd.${name}`);
      if (set !== undefined) add(set, `Cmd.${name}`);
    }
    for (const [name, a] of Object.entries(Act)) add(a.legacy.code, `Act.${name}`);
    const shared = [...owners.values()].filter((o) => o.length > 1);
    for (const o of shared) expect(new Set(o).size, o.join(' & ')).toBe(1);
    expect(shared.map((o) => o[0]).sort()).toEqual(['Cmd.Limiter', 'Cmd.OutputLatency']);
  });
});
