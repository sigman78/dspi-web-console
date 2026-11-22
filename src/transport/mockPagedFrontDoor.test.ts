import { describe, it, expect, beforeEach } from 'vitest';
import { MockTransport } from './MockTransport';
import { TransportStall } from './DspTransport';
import { Cmd } from '@/protocol';
import { PagedCmd, VcResult } from '@/protocol/paged.gen';
import { parseLastResult } from '@/protocol/pagedExec';
import { Codec } from '@/utils';

const LAST_RESULT = PagedCmd.SYS.LAST_RESULT.id;
const GAIN = PagedCmd.ROUTE.OUTPUT_GAIN.id;
const PIN = PagedCmd.OUTPUT.PIN.id;
const f32 = (n: number) => Codec.encode(Codec.f32, n);

let mock: MockTransport;

beforeEach(async () => {
  mock = new MockTransport({ paged: true, platform: 'rp2350' });
  await mock.open();
});

async function last() {
  return parseLastResult(await mock.ctrlIn(LAST_RESULT, 0, 8));
}

describe('mock paged front door', () => {
  it('refuses page 0 and records it as unknown', async () => {
    await expect(mock.ctrlIn(Cmd.OutputGain.legacy.get, 2, 4)).rejects.toBeInstanceOf(TransportStall);
    expect(await last()).toEqual({ id: Cmd.OutputGain.legacy.get, dir: 'get', vc: VcResult.VC_ERR_UNKNOWN, wValue: 2 });
  });

  it('records a wrong direction', async () => {
    await expect(mock.ctrlOut(LAST_RESULT, 0, new Uint8Array(1))).rejects.toBeInstanceOf(TransportStall);
    expect(await last()).toMatchObject({ id: LAST_RESULT, dir: 'set', vc: VcResult.VC_ERR_DIRECTION });
  });

  it('does not record its own read', async () => {
    await expect(mock.ctrlOut(GAIN, 1, new Uint8Array(1))).rejects.toBeInstanceOf(TransportStall);
    await last();
    expect(await last()).toMatchObject({ id: GAIN, vc: VcResult.VC_ERR_LENGTH, wValue: 1 });
  });

  it('records successes too', async () => {
    await mock.ctrlOut(GAIN, 1, f32(-2));
    expect(await last()).toEqual({ id: GAIN, dir: 'set', vc: VcResult.VC_OK, wValue: 1 });
  });

  it('a direct SET lands in the legacy state and a GET reads it back, clamped to wLength', async () => {
    await mock.ctrlOut(GAIN, 1, f32(-4.5));
    expect(Codec.decode(Codec.f32, await mock.ctrlIn(GAIN, 1, 4))).toBe(-4.5);
    expect((await mock.ctrlIn(GAIN, 1, 2)).length).toBe(2);
    expect((await mock.ctrlIn(GAIN, 1, 64)).length).toBe(4);
  });

  it('an act SET with the current pin succeeds', async () => {
    const [pin] = await mock.ctrlIn(PIN, 0, 1);
    await mock.ctrlOut(PIN, 0, new Uint8Array([pin]));
    expect(await last()).toMatchObject({ id: PIN, dir: 'set', vc: VcResult.VC_OK });
  });

  it('an act SET with a bad pin is refused as PIN_INVALID and changes nothing', async () => {
    const [before] = await mock.ctrlIn(PIN, 0, 1);
    await expect(mock.ctrlOut(PIN, 0, new Uint8Array([99]))).rejects.toBeInstanceOf(TransportStall);
    expect(await last()).toMatchObject({ id: PIN, vc: VcResult.VC_ERR_PIN_INVALID });
    expect((await mock.ctrlIn(PIN, 0, 1))[0]).toBe(before);
  });

  it('injected refusals apply the given number of times', async () => {
    mock.injectRefusal(GAIN, VcResult.VC_ERR_BUSY, 1);
    await expect(mock.ctrlOut(GAIN, 0, f32(0))).rejects.toBeInstanceOf(TransportStall);
    expect(await last()).toMatchObject({ vc: VcResult.VC_ERR_BUSY });
    await mock.ctrlOut(GAIN, 0, f32(0));
  });

  it('an injected refusal on LAST_RESULT does not record itself', async () => {
    await mock.ctrlOut(GAIN, 1, f32(-2));
    mock.injectRefusal(LAST_RESULT, VcResult.VC_ERR_BUSY, 1);
    await expect(mock.ctrlIn(LAST_RESULT, 0, 8)).rejects.toBeInstanceOf(TransportStall);
    expect(await last()).toMatchObject({ id: GAIN, vc: VcResult.VC_OK });
  });
});
