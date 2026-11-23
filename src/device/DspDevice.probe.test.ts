import { describe, it, expect } from 'vitest';
import { DspDevice, ProtocolTooNew, UnrecognizedProbeReply } from './DspDevice';
import { MockTransport } from '@/transport/MockTransport';
import { PAGED_PROTOCOL_INFO } from '@/protocol';
import type { DspTransport } from '@/transport/DspTransport';

function recording(inner: DspTransport): { transport: DspTransport; calls: { dir: 'in' | 'out'; cmd: number }[] } {
  const calls: { dir: 'in' | 'out'; cmd: number }[] = [];
  const transport: DspTransport = {
    open: () => inner.open(),
    close: () => inner.close(),
    isOpen: () => inner.isOpen(),
    on: (event, listener) => inner.on(event, listener),
    ctrlIn: (cmd, value, length) => { calls.push({ dir: 'in', cmd }); return inner.ctrlIn(cmd, value, length); },
    ctrlOut: (cmd, value, data) => { calls.push({ dir: 'out', cmd }); return inner.ctrlOut(cmd, value, data); },
  };
  return { transport, calls };
}

function stub(ctrlIn: DspTransport['ctrlIn']): DspTransport {
  return {
    open: async () => {}, close: async () => {}, isOpen: () => true, on: () => () => {},
    ctrlIn,
    ctrlOut: async () => {},
  };
}

describe('connect probe', () => {
  it('sends the protocol probe first on a legacy device, then connects as before', async () => {
    const { transport, calls } = recording(new MockTransport({ platform: 'rp2350' }));
    const dev = await DspDevice.create(transport);
    expect(calls[0]).toEqual({ dir: 'in', cmd: PAGED_PROTOCOL_INFO });
    expect(calls.slice(1).every((c) => c.cmd <= 0xFF)).toBe(true);
    expect(dev.info.serial).not.toBe('');
  });

  it('flags a newer protocol major so the user is told to update the console', async () => {
    const reply = new Uint8Array([0x44, 0x53, 0x50, 0x69, 0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const sent: number[] = [];
    const err = await DspDevice.create(stub(async (cmd) => { sent.push(cmd); return reply; })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProtocolTooNew);
    expect((err as ProtocolTooNew).protocolMajor).toBe(2);
    expect(sent).toEqual([PAGED_PROTOCOL_INFO]);
  });

  it('never guesses: a non-stall reply without the DSPi magic fails the connect', async () => {
    let sent = 0;
    const t = stub(async (_c, _v, length) => { sent++; return new Uint8Array(length); });
    await expect(DspDevice.create(t)).rejects.toBeInstanceOf(UnrecognizedProbeReply);
    expect(sent).toBe(1);
  });

  it('treats a NetworkError from the probe (WinUSB-style stall) as legacy and carries on', async () => {
    const inner = new MockTransport({ platform: 'rp2350' });
    const t: DspTransport = {
      open: () => inner.open(), close: () => inner.close(), isOpen: () => inner.isOpen(), on: (e, l) => inner.on(e, l),
      ctrlIn: (cmd, value, length) => {
        if (cmd === PAGED_PROTOCOL_INFO) return Promise.reject(Object.assign(new Error('A transfer error has occurred.'), { name: 'NetworkError' }));
        return inner.ctrlIn(cmd, value, length);
      },
      ctrlOut: (cmd, value, data) => inner.ctrlOut(cmd, value, data),
    };
    const dev = await DspDevice.create(t);
    expect(dev.info.serial).not.toBe('');
  });

  it('rethrows a non-stall probe failure instead of treating it as legacy', async () => {
    const t = stub(async () => { throw new Error('device lost'); });
    await expect(DspDevice.create(t)).rejects.toThrow('device lost');
  });
});
