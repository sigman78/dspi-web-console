import { describe, it, expect } from 'vitest';
import { translateLegacy, UntranslatedCommand, type LegacyDir } from './legacyTranslate';
import type { ExclusiveTransport } from './pagedExec';
import { Cmd, Act } from './commands';
import { PagedCmd, VcResult } from './paged.gen';
import { pagedCommand } from './paged';
import { RefusedError, TransportStall, type DspTransport } from '@/transport/DspTransport';
import { MockPagedFrontDoor } from '@/transport/mockPagedFrontDoor';
import { withGenerationGuard, GenerationRefusal } from '@/transport/withGenerationGuard';
import { CommandRefused } from './pagedExec';
import { Codec } from '@/utils';

interface Sent { dir: 'get' | 'set'; id: number; wValue: number; data?: Uint8Array; length?: number }

// A paged device that records requests and answers every one, or refuses the
// requests of one direction with `refuse` (recorded in LAST_RESULT the way the
// firmware does).
function recorder(refuse?: number, refused: 'get' | 'set' = 'set'): { t: ExclusiveTransport; sent: Sent[] } {
  const sent: Sent[] = [];
  let last = new Uint8Array(8);
  const raw: DspTransport = {
    open: async () => {}, close: async () => {}, isOpen: () => true, on: () => () => {},
    async ctrlIn(id, wValue, length) {
      if (id === PagedCmd.SYS.LAST_RESULT.id) return last;
      sent.push({ dir: 'get', id, wValue, length });
      if (refuse !== undefined && refused === 'get') {
        last = new Uint8Array(8);
        const v = new DataView(last.buffer);
        v.setUint16(0, id, true);
        last[2] = 1;
        last[3] = refuse;
        v.setUint16(4, wValue, true);
        throw new TransportStall('refused');
      }
      return new Uint8Array(length);
    },
    async ctrlOut(id, wValue, data) {
      sent.push({ dir: 'set', id, wValue, data });
      if (refuse === undefined || refused === 'get') return;
      last = new Uint8Array(8);
      const v = new DataView(last.buffer);
      v.setUint16(0, id, true);
      last[2] = 0;
      last[3] = refuse;
      v.setUint16(4, wValue, true);
      throw new TransportStall('refused');
    },
  };
  return { t: { exclusive: (fn) => fn(raw) }, sent };
}

const GET = (t: ExclusiveTransport, code: number, wValue: number, length = 4) => translateLegacy(t, code, 'in', wValue, length);
const SET = (t: ExclusiveTransport, code: number, wValue: number, data = new Uint8Array(0)) => translateLegacy(t, code, 'out', wValue, data);

describe('direct adapters', () => {
  it('forwards wValue as the address when the map names none', async () => {
    const { t, sent } = recorder();
    await GET(t, 0x11, 3, 4);
    await SET(t, 0x10, 5, Uint8Array.of(1, 2));
    expect(sent).toEqual([
      { dir: 'get', id: 2080, wValue: 3, length: 4 },
      { dir: 'set', id: 2080, wValue: 5, data: Uint8Array.of(1, 2) },
    ]);
  });

  it('takes the address from a wValue field', async () => {
    const { t, sent } = recorder();
    await SET(t, 0x04, 0x1207, Uint8Array.of(9));
    expect(sent).toEqual([{ dir: 'set', id: 2656, wValue: 7, data: Uint8Array.of(9) }]);
  });

  it('uses a constant address', async () => {
    const { t, sent } = recorder();
    await GET(t, 0x26, 7, 8);
    expect(sent).toEqual([{ dir: 'get', id: 2579, wValue: 0, length: 8 }]);
  });

  it('cuts an OUT payload to trunc', async () => {
    const { t, sent } = recorder();
    await SET(t, 0x8B, 4, new Uint8Array(40).fill(7));
    expect(sent[0].data).toEqual(new Uint8Array(32).fill(7));
  });
});

describe('split adapters', () => {
  it('picks the case by selector, else the default', async () => {
    const { t, sent } = recorder();
    await GET(t, 0x05, 0xFFFF);
    await GET(t, 0x05, 3);
    expect(sent.map((s) => [s.id, s.wValue])).toEqual([[2658, 0], [2656, 3]]);
  });

  it('applies the case address to the full legacy wValue', async () => {
    const { t, sent } = recorder();
    await GET(t, 0x81, 0x0502);
    expect(sent.map((s) => [s.id, s.wValue])).toEqual([[1810, 5]]);
  });

  it('refuses a selector the map nulls out', async () => {
    const { t, sent } = recorder();
    await expect(GET(t, 0x03, 2)).rejects.toBeInstanceOf(UntranslatedCommand);
    expect(sent).toEqual([]);
  });
});

describe('on_stall', () => {
  // GET_ADAT_STATUS: an 8-byte zero reply where the device lacks the command.
  it.each([VcResult.VC_ERR_UNKNOWN, VcResult.VC_ERR_UNSUPPORTED])('answers the fill for a GET refused with result %i', async (vc) => {
    const { t } = recorder(vc, 'get');
    expect(await GET(t, 0xCE, 0, 8)).toEqual(new Uint8Array(8));
  });

  it('answers a non-zero fill, clamped to the requested length', async () => {
    // GET_ADAT_INPUT_PIN: 0xFF means no pin.
    const { t } = recorder(VcResult.VC_ERR_UNKNOWN, 'get');
    expect(await GET(t, 0x6B, 0, 1)).toEqual(Uint8Array.of(0xFF));
  });

  it('rethrows a refusal the entry does not list', async () => {
    const { t } = recorder(VcResult.VC_ERR_ADDRESS, 'get');
    await expect(GET(t, 0xCE, 0, 8)).rejects.toBeInstanceOf(CommandRefused);
  });

  it('rethrows a refusal on a GET with no on_stall entry', async () => {
    const { t } = recorder(VcResult.VC_ERR_UNKNOWN, 'get');
    await expect(GET(t, 0x11, 0, 4)).rejects.toBeInstanceOf(CommandRefused);
  });

  it('treats a command the connected device lacks as unknown', async () => {
    const raw: DspTransport = {
      open: async () => {}, close: async () => {}, isOpen: () => true, on: () => () => {},
      ctrlIn: async () => new Uint8Array(0), ctrlOut: async () => {},
    };
    const guard = withGenerationGuard(raw);
    guard.setGeneration('paged');
    guard.narrow(() => false);
    const t: ExclusiveTransport = { exclusive: (fn) => fn(guard) };
    expect(await GET(t, 0xCE, 0, 8)).toEqual(new Uint8Array(8));
    await expect(GET(t, 0x11, 0, 4)).rejects.toBeInstanceOf(GenerationRefusal);
  });
});

describe('write-as-read adapters', () => {
  it('act_value: encodes the value into one byte and answers the success byte', async () => {
    const { t, sent } = recorder();
    expect(await GET(t, 0xB1, 1, 1)).toEqual(Uint8Array.of(1));
    expect(sent).toEqual([{ dir: 'set', id: 335, wValue: 0, data: Uint8Array.of(1) }]);
  });

  it('act_value: saturates or reduces to a flag as the map says', async () => {
    const { t, sent } = recorder();
    await GET(t, 200, 300, 1);
    await GET(t, 196, 0x0100, 1);
    await GET(t, 198, 0x1234, 1);
    expect(sent.map((s) => s.data)).toEqual([Uint8Array.of(255), Uint8Array.of(1), Uint8Array.of(0x34)]);
  });

  it('act_addr: a zero-length SET at the address', async () => {
    const { t, sent } = recorder();
    expect(await GET(t, 0x90, 6, 1)).toEqual(Uint8Array.of(0));
    expect(sent).toEqual([{ dir: 'set', id: 528, wValue: 6, data: new Uint8Array(0) }]);
  });

  it('act_packed: splits the address and the value out of wValue', async () => {
    const { t, sent } = recorder();
    await GET(t, 0x7C, 0x0705, 1);
    expect(sent).toEqual([{ dir: 'set', id: 1041, wValue: 5, data: Uint8Array.of(7) }]);
  });

  it('maps a refusal to the family byte', async () => {
    const { t } = recorder(VcResult.VC_ERR_ADDRESS);
    expect(await GET(t, 0x90, 99, 1)).toEqual(Uint8Array.of(1));
  });

  it('prefers the opcode override over the family table', async () => {
    // SET_OUTPUT_TYPE answers 1 for a bad value where the pin family says 5.
    const { t } = recorder(VcResult.VC_ERR_VALUE);
    expect(await GET(t, 0xC0, 0x0900, 1)).toEqual(Uint8Array.of(1));
  });

  it('rethrows a refusal the family does not map', async () => {
    const { t } = recorder(VcResult.VC_ERR_ADDRESS);
    // ack1 maps nothing: any refusal stays a refusal.
    await expect(GET(t, 0xB1, 1, 1)).rejects.toBeInstanceOf(RefusedError);
  });
});

const hex = (n: number) => `0x${n.toString(16)}`;

describe('untranslatable requests', () => {
  it.each<[number, LegacyDir, string]>([
    [0x50, 'in', 'GET_STATUS is custom'],
    [0xA1, 'out', 'SET_ALL_PARAMS is custom'],
    [0x41, 'in', 'the system clock opcodes are not in the map'],
    [0x7F, 'out', 'GET_PLATFORM has no OUT direction'],
  ])('%#: refuses before anything is sent', async (code, dir) => {
    const { t, sent } = recorder();
    const run = dir === 'in' ? GET(t, code, 0) : SET(t, code, 0);
    const err = await run.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UntranslatedCommand);
    expect(err).toBeInstanceOf(RefusedError);
    expect((err as UntranslatedCommand).message).toContain(hex(code));
    expect(sent).toEqual([]);
  });
});

interface Op { code: number; dir: LegacyDir; name: string }

// Every legacy (opcode, direction) the console uses.
function consoleOpcodes(): Op[] {
  const out: Op[] = [];
  for (const [name, c] of Object.entries(Cmd)) {
    const { get, set } = c.legacy as { get?: number; set?: number };
    if (get !== undefined) out.push({ code: get, dir: 'in', name: `Cmd.${name} 0x${get.toString(16)} IN` });
    if (set !== undefined) out.push({ code: set, dir: 'out', name: `Cmd.${name} 0x${set.toString(16)} OUT` });
  }
  for (const [name, a] of Object.entries(Act)) out.push({ code: a.legacy.code, dir: 'in', name: `Act.${name} 0x${a.legacy.code.toString(16)} IN` });
  return out;
}

// wValues that reach every split case, with a few addresses on top.
function candidates(): number[] {
  const out = new Set<number>([0xFFFF, 0x80, 0x81, 0x82, 0x83, 0x8001]);
  for (let sel = 0; sel < 32; sel++) for (const hi of [0, 1, 2, 3]) out.add(sel | (hi << 8));
  return [...out];
}

// The paged request a legacy one becomes; null when the map has no rule for it.
async function forward(code: number, dir: LegacyDir, wValue: number): Promise<Sent | null> {
  const { t, sent } = recorder();
  try {
    if (dir === 'in') await GET(t, code, wValue, 4);
    else await SET(t, code, wValue, new Uint8Array(64));
  } catch (err) {
    if (err instanceof UntranslatedCommand) return null;
    throw err;
  }
  return sent[0];
}

// What the mock front door asks its 1.1.6 handlers for a paged request: the
// inverse of the translation. A SET carries the translated payload, or zeros of the width its command wants.
async function inverse(req: Sent): Promise<{ code: number; dir: LegacyDir; wValue: number } | null> {
  let call: { code: number; dir: LegacyDir; wValue: number } | null = null;
  const door = new MockPagedFrontDoor(
    {
      legacyIn: async (code, wValue, length) => { call = { code, dir: 'in', wValue }; return new Uint8Array(Math.max(length, 1)); },
      legacyOut: async (code, wValue) => { call = { code, dir: 'out', wValue }; },
      closeChunkSessions: () => {},
      inputBlocks: { read: () => ({ spdifEnabled: true, spdifCount: 4, i2sEnabled: true }), write: () => {}, claimBlocked: () => false },
    },
    new Uint8Array(0), true,
  );
  try {
    if (req.dir === 'get') await door.ctrlIn(req.id, req.wValue, req.length ?? 4);
    else {
      const cmd = pagedCommand(req.id)!;
      const fits = req.data !== undefined && req.data.length >= (cmd.setMin ?? 1) && req.data.length <= (cmd.setMax ?? 64);
      // The I2S rate takes only a known rate; the door refuses zeros before running a handler.
      const zeros = req.id === PagedCmd.INPUT.I2S_RX_RATE.id ? Codec.encode(Codec.u32, 48000) : new Uint8Array(cmd.setMin ?? 64);
      await door.ctrlOut(req.id, req.wValue, fits ? req.data! : zeros);
    }
  } catch { /* a refused reply still records the legacy call it made */ }
  return call;
}

describe('forward translation against the mock front door', () => {
  it('lands every opcode the console uses on its own legacy handler', async () => {
    const problems: string[] = [];
    for (const op of consoleOpcodes()) {
      for (const wValue of candidates()) {
        const req = await forward(op.code, op.dir, wValue);
        if (!req) continue;
        const cmd = pagedCommand(req.id);
        if (!cmd || !(req.dir === 'get' ? cmd.get : cmd.set)) {
          problems.push(`${op.name}: ${hex(req.id)} is no ${req.dir} command in the registry`);
          continue;
        }
        // The firmware refuses a nonzero wValue on an unaddressed command before any handler runs.
        if (cmd.addr === 'NONE' && req.wValue !== 0) continue;
        const back = await inverse(req);
        // GET_PREAMP (0x45) is retired: its paged command is the input preamp at address 0.
        const want = op.code === 0x45 ? { code: 0xD1, dir: 'in', wValue: 0 } : { code: op.code, dir: op.dir, wValue };
        if (!back) problems.push(`${op.name} w=${hex(wValue)}: the door runs no legacy handler for ${cmd.name}`);
        else if (back.code !== want.code || back.dir !== want.dir) problems.push(`${op.name} w=${hex(wValue)}: ${cmd.name} came back as ${hex(back.code)}`);
        else if (back.wValue !== want.wValue) {
          // wValue bits outside the selector and address fields do not survive; they must still translate alike.
          const again = await forward(back.code, back.dir, back.wValue);
          if (again?.id !== req.id || again.wValue !== req.wValue) problems.push(`${op.name} w=${hex(wValue)}: ${cmd.name} came back with w=${hex(back.wValue)}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it.each<[string, number, LegacyDir, number]>([
    ['direct, address in the low byte', 0x04, 'out', 0x0007],
    ['direct, wValue as address', 0x74, 'out', 0x0003],
    ['split with the address in the high byte', 0x81, 'in', 0x0502],
    ['split default address', 0x05, 'in', 0x0003],
    ['act_addr', 0x90, 'in', 0x0006],
    ['act_packed, value in the high byte', 0x7C, 'in', 0x0705],
    ['act_packed, value in the low byte', 0xF1, 'in', 0x0903],
    ['input preamp read keeps its channel', 0xD1, 'in', 0x0002],
  ])('returns %s to the same legacy wValue', async (_what, code, dir, wValue) => {
    const req = (await forward(code, dir, wValue))!;
    expect(await inverse(req)).toEqual({ code, dir, wValue });
  });

  it('leaves untranslated only what the map has no rule for', async () => {
    const none: string[] = [];
    for (const op of consoleOpcodes()) {
      const any = await Promise.all(candidates().map((w) => forward(op.code, op.dir, w)));
      if (any.every((r) => r === null)) none.push(op.name);
    }
    expect(none.sort()).toEqual([
      'Act.SaveParams 0x51 IN', 'Act.SpdifInputEnable 0xe9 IN', 'Cmd.AllParams 0xa1 OUT', 'Cmd.ClearClips 0x83 IN',
      'Cmd.CsDisplayCfgResponse 0x28 IN', 'Cmd.EqParam 0x42 OUT', 'Cmd.EqParamValue 0x43 IN', 'Cmd.InputRateStatus 0xee IN',
      'Cmd.MatrixRoute 0x70 OUT', 'Cmd.MatrixRoute 0x71 IN', 'Cmd.Preamp 0x44 OUT', 'Cmd.PresetStartup 0x97 IN',
      'Cmd.Status 0x50 IN', 'Cmd.SysClock 0x40 OUT', 'Cmd.SysClockStatus 0x41 IN',
    ].sort());
  });
});
