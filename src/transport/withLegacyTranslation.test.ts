import { describe, it, expect } from 'vitest';
import { withLegacyTranslation } from './withLegacyTranslation';
import { withGenerationGuard, GenerationRefusal } from './withGenerationGuard';
import { withSerializedCtrl } from './withSerializedCtrl';
import { TransportStall, type DspTransport } from './DspTransport';
import { UntranslatedCommand } from '@/protocol/legacyTranslate';
import { CommandRefused } from '@/protocol/pagedExec';
import { PagedCmd, VcResult } from '@/protocol/paged.gen';
import { PAGED_PROTOCOL_INFO } from '@/protocol';

const LAST_RESULT = PagedCmd.SYS.LAST_RESULT.id;
// Legacy 0x11 (IN) and 0x10 (OUT) are the direct pair on this paged command.
const PAIR = 2080;

type Call = [dir: 'in' | 'out', id: number, wValue: number];

// Answers every request; `stallFirstGet` makes the first PAIR GET refuse with
// ADDRESS after a pause, the way a paged device does.
function device(opts: { stallFirstGet?: boolean } = {}) {
  const calls: Call[] = [];
  let stalled = !opts.stallFirstGet;
  let last = new Uint8Array(8);
  const transport: DspTransport = {
    open: async () => {}, close: async () => {}, isOpen: () => true, on: () => () => {},
    async ctrlIn(id, wValue, length) {
      calls.push(['in', id, wValue]);
      if (id === LAST_RESULT) return last;
      if (id === PAIR && !stalled) {
        stalled = true;
        await Promise.resolve();
        last = new Uint8Array(8);
        new DataView(last.buffer).setUint16(0, id, true);
        last[2] = 1;
        last[3] = VcResult.VC_ERR_ADDRESS;
        new DataView(last.buffer).setUint16(4, wValue, true);
        throw new TransportStall('refused');
      }
      return new Uint8Array(length);
    },
    async ctrlOut(id, wValue) { calls.push(['out', id, wValue]); },
    notifyIn: async (length) => new Uint8Array(length).fill(9),
  };
  return { transport, calls };
}

describe('withLegacyTranslation', () => {
  it('passes every request through unchanged on a legacy connection', async () => {
    const { transport, calls } = device();
    const guard = withGenerationGuard(transport);
    guard.setGeneration('legacy');
    const t = withLegacyTranslation(guard);
    await t.ctrlIn(0x45, 0, 4);
    await t.ctrlOut(0x44, 3, Uint8Array.of(1));
    expect(calls).toEqual([['in', 0x45, 0], ['out', 0x44, 3]]);
  });

  it('runs a legacy request as its paged equivalent on a paged connection', async () => {
    const { transport, calls } = device();
    const guard = withGenerationGuard(transport);
    guard.setGeneration('paged');
    const t = withLegacyTranslation(guard);
    await t.ctrlIn(0x11, 6, 4);
    await t.ctrlOut(0x10, 7, Uint8Array.of(1));
    expect(calls).toEqual([['in', PAIR, 6], ['out', PAIR, 7]]);
  });

  it('leaves a paged ID untouched', async () => {
    const { transport, calls } = device();
    const guard = withGenerationGuard(transport);
    guard.setGeneration('paged');
    await withLegacyTranslation(guard).ctrlIn(PagedCmd.SYS.PLATFORM.id, 0, 4);
    expect(calls).toEqual([['in', PagedCmd.SYS.PLATFORM.id, 0]]);
  });

  it('lets only the probe through before the generation is known', async () => {
    const { transport, calls } = device();
    const t = withLegacyTranslation(withGenerationGuard(transport));
    await expect(t.ctrlIn(0x45, 0, 4)).rejects.toBeInstanceOf(GenerationRefusal);
    await t.ctrlIn(PAGED_PROTOCOL_INFO, 0, 4);
    expect(calls).toEqual([['in', PAGED_PROTOCOL_INFO, 0]]);
  });

  it('refuses an untranslatable legacy request without sending it', async () => {
    const { transport, calls } = device();
    const guard = withGenerationGuard(transport);
    guard.setGeneration('paged');
    await expect(withLegacyTranslation(guard).ctrlIn(0x50, 9, 4)).rejects.toBeInstanceOf(UntranslatedCommand);
    expect(calls).toEqual([]);
  });

  it('keeps the SET refusal of a read-only guard', async () => {
    const { transport, calls } = device();
    const guard = withGenerationGuard(transport);
    guard.setGeneration('paged');
    guard.narrow((id, dir) => dir === 'in' && id === PAIR);
    await expect(withLegacyTranslation(guard).ctrlOut(0x10, 0, Uint8Array.of(1))).rejects.toBeInstanceOf(GenerationRefusal);
    expect(calls).toEqual([]);
  });

  it('forwards the notify endpoint', async () => {
    const { transport } = device();
    const t = withLegacyTranslation(withGenerationGuard(transport));
    expect(await t.notifyIn!(2)).toEqual(Uint8Array.of(9, 9));
  });
});

describe('inside the serializer', () => {
  function stack() {
    const { transport, calls } = device({ stallFirstGet: true });
    const guard = withGenerationGuard(transport);
    guard.setGeneration('paged');
    return { t: withSerializedCtrl(withLegacyTranslation(guard)), calls };
  }

  it('keeps a refused request and its LAST_RESULT read in one slot', async () => {
    const { t, calls } = stack();
    const first = t.ctrlIn(0x11, 1, 4);
    const second = t.ctrlIn(0x11, 2, 4);
    await expect(first).rejects.toBeInstanceOf(CommandRefused);
    await second;
    expect(calls).toEqual([['in', PAIR, 1], ['in', LAST_RESULT, 0], ['in', PAIR, 2]]);
  });

  it('translates a legacy request made inside an exclusive unit', async () => {
    const { transport, calls } = device();
    const guard = withGenerationGuard(transport);
    guard.setGeneration('paged');
    const t = withSerializedCtrl(withLegacyTranslation(guard));
    await t.exclusive(async (raw) => { await raw.ctrlIn(0x11, 4, 4); await raw.ctrlIn(0x11, 5, 4); });
    expect(calls).toEqual([['in', PAIR, 4], ['in', PAIR, 5]]);
  });
});
