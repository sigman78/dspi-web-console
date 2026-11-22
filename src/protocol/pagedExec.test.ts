import { describe, it, expect, beforeEach } from 'vitest';
import { MockTransport } from '@/transport/MockTransport';
import { withSerializedCtrl, type SerializedDspTransport } from '@/transport/withSerializedCtrl';
import { TransportStall, type DspTransport } from '@/transport/DspTransport';
import { Codec } from '@/utils';
import { PagedCmd, VcResult } from './paged.gen';
import type { VcByte } from './legacyMap.gen';
import { CommandRefused, pagedAction, pagedGet, pagedSet, parseLastResult } from './pagedExec';

const GAIN = PagedCmd.ROUTE.OUTPUT_GAIN.id;
const PIN = PagedCmd.OUTPUT.PIN.id;
const LAST_RESULT = PagedCmd.SYS.LAST_RESULT.id;
const f32 = (n: number) => Codec.encode(Codec.f32, n);

let mock: MockTransport;
let t: SerializedDspTransport;

beforeEach(async () => {
  mock = new MockTransport({ paged: true, platform: 'rp2350' });
  await mock.open();
  t = withSerializedCtrl(mock);
});

async function refusal(p: Promise<unknown>): Promise<CommandRefused> {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(CommandRefused);
  return err as CommandRefused;
}

// A serialized view of the mock that lets a test observe or delay requests.
function wrapped(hooks: {
  ctrlIn?: (c: number) => Promise<void> | void;
  ctrlOut?: (c: number) => void;
}): SerializedDspTransport {
  return withSerializedCtrl({
    open: () => mock.open(),
    close: () => mock.close(),
    isOpen: () => true,
    on: (e, l) => mock.on(e, l),
    ctrlIn: async (c, v, l) => { await hooks.ctrlIn?.(c); return mock.ctrlIn(c, v, l); },
    ctrlOut: async (c, v, d) => { hooks.ctrlOut?.(c); return mock.ctrlOut(c, v, d); },
  });
}

describe('pagedGet / pagedSet', () => {
  it('round-trips a value', async () => {
    await pagedSet(t, GAIN, 0, f32(-6));
    expect(Codec.decode(Codec.f32, await pagedGet(t, GAIN, 0, 4))).toBe(-6);
  });

  it('a wrong-length SET is refused with the recorded reason', async () => {
    const err = await refusal(pagedSet(t, GAIN, 0, new Uint8Array(2)));
    expect(err.reason).toBe('length');
    expect(err.vc).toBe(VcResult.VC_ERR_LENGTH);
    expect(err.cmd).toBe(GAIN);
    expect(err.dir).toBe('set');
  });

  it('retries BUSY unchanged and then succeeds', async () => {
    mock.injectRefusal(GAIN, VcResult.VC_ERR_BUSY, 3);
    await pagedSet(t, GAIN, 0, f32(-3));
    expect(Codec.decode(Codec.f32, await pagedGet(t, GAIN, 0, 4))).toBe(-3);
  });

  it('reports busy once the retries are spent', async () => {
    mock.injectRefusal(GAIN, VcResult.VC_ERR_BUSY, 10);
    const err = await refusal(pagedSet(t, GAIN, 0, f32(-3)));
    expect(err.reason).toBe('busy');
  });

  const record = (id: number, dir: number, vc: number, wValue: number) => {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setUint16(0, id, true);
    b[2] = dir;
    b[3] = vc;
    new DataView(b.buffer).setUint16(4, wValue, true);
    return b;
  };
  const networkError = () => Object.assign(new Error('transfer failed'), { name: 'NetworkError' });

  // A raw transport whose SET fails with `fail` and whose LAST_RESULT read does `onRead`.
  const rawSet = (fail: Error, onRead: () => Promise<Uint8Array>) => ({
    exclusive: <T>(fn: (raw: DspTransport) => Promise<T>) =>
      fn({ ctrlIn: onRead, ctrlOut: async () => { throw fail; } } as unknown as DspTransport),
  });

  it.each([
    ['id', record(GAIN + 1, 0, VcResult.VC_ERR_LENGTH, 0)],
    ['direction', record(GAIN, 1, VcResult.VC_ERR_LENGTH, 0)],
    ['wValue', record(GAIN, 0, VcResult.VC_ERR_LENGTH, 9)],
  ])('rethrows the original STALL when the record differs in %s', async (_field, rec) => {
    const stall = new TransportStall('stall');
    const err = await pagedSet(rawSet(stall, async () => rec), GAIN, 0, f32(0)).then(() => null, (e: unknown) => e);
    expect(err).toBe(stall);
  });

  it('explain: false rethrows the STALL and never reads LAST_RESULT', async () => {
    const reads: number[] = [];
    const spy = wrapped({ ctrlIn: (c) => { reads.push(c); } });
    const err = await pagedSet(spy, GAIN, 0, new Uint8Array(2), { explain: false }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(TransportStall);
    expect(reads).not.toContain(LAST_RESULT);
  });

  it('explains a WinUSB NetworkError STALL', async () => {
    const t2 = rawSet(networkError(), async () => record(GAIN, 0, VcResult.VC_ERR_LENGTH, 0));
    expect((await refusal(pagedSet(t2, GAIN, 0, f32(0)))).reason).toBe('length');
  });

  it('a failing LAST_RESULT read propagates its own error', async () => {
    const dead = networkError();
    const t2 = rawSet(networkError(), async () => { throw dead; });
    const err = await pagedSet(t2, GAIN, 0, f32(0)).then(() => null, (e: unknown) => e);
    expect(err).toBe(dead);
  });

  it('propagates non-STALL errors unchanged', async () => {
    const boom = new Error('timeout');
    const raw = { ctrlIn: async () => { throw boom; } } as unknown as DspTransport;
    const err = await pagedGet({ exclusive: (fn) => fn(raw) }, GAIN, 0, 4).then(() => null, (e: unknown) => e);
    expect(err).toBe(boom);
  });

  it('keeps a refusal and its explanation together on the queue', async () => {
    const order: string[] = [];
    const slow = wrapped({
      ctrlIn: async (c) => {
        order.push(c === LAST_RESULT ? 'last' : 'get');
        if (c === LAST_RESULT) await new Promise((r) => setTimeout(r, 5));
      },
      ctrlOut: () => { order.push('set'); },
    });
    const refused = refusal(pagedSet(slow, GAIN, 0, new Uint8Array(2)));
    const other = slow.ctrlIn(GAIN, 0, 4);
    await Promise.all([refused, other]);
    expect(order).toEqual(['set', 'last', 'get']);
  });
});

describe('pagedAction', () => {
  it('answers the pin family success byte', async () => {
    const [pin] = await pagedGet(t, PIN, 0, 1);
    expect(await pagedAction(t, PIN, 0, new Uint8Array([pin]), 'pin')).toBe(0);
  });

  it('maps a refused pin to its family byte', async () => {
    expect(await pagedAction(t, PIN, 0, new Uint8Array([99]), 'pin')).toBe(1);
  });

  it('rethrows a refusal the family does not map', async () => {
    const err = await refusal(pagedAction(t, PIN, 0, new Uint8Array(3), 'pin'));
    expect(err.reason).toBe('length');
  });

  it('statusOverrides win over the family table', async () => {
    const overrides: VcByte[] = [[VcResult.VC_ERR_PIN_INVALID, 7]];
    expect(await pagedAction(t, PIN, 0, new Uint8Array([99]), 'pin', { statusOverrides: overrides })).toBe(7);
  });
});

describe('parseLastResult', () => {
  it('reads the record fields', () => {
    expect(parseLastResult(new Uint8Array([0x14, 0x01, 1, 0x12, 0x07, 0x00, 0, 0])))
      .toEqual({ id: 0x0114, dir: 'get', vc: 0x12, wValue: 7 });
  });

  it('rejects a short reply', () => {
    expect(parseLastResult(new Uint8Array(3))).toBeNull();
  });
});
