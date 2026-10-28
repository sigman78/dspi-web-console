// Release-branch-head firmware surface (MockOptions.fwHead): selectable
// output latency, ring-health counters, background CS revert, caps v21.

import { describe, it, expect, vi } from 'vitest';
import { MockTransport } from '@/transport/MockTransport';
import { DspDevice } from './DspDevice';
import * as Protocol from '@/protocol';
import * as Domain from '@/domain';

const head = () => DspDevice.create(new MockTransport({ platform: 'rp2350', fwHead: true, wireVersion: Protocol.Wire.MAX_WIRE_VERSION }));
const beta4 = () => DspDevice.create(new MockTransport({ platform: 'rp2350', wireVersion: Protocol.Wire.MAX_WIRE_VERSION }));

// Reads status until the staged option has been applied.
async function settled(d: DspDevice) {
  let st = await d.getOutputLatencyStatus();
  for (let i = 0; i < 10 && st.pending; i++) st = await d.getOutputLatencyStatus();
  return st;
}

describe('output latency (0x03)', () => {
  it('reports the 4 ms default with the option table', async () => {
    const d = await head();
    const st = await d.getOutputLatencyStatus();
    expect(st).toMatchObject({ requestedId: 5, effectiveId: 5, effectiveUs: 4000, targetFrames: 192, pending: false, optionCount: 7 });
    expect(await d.getOutputLatencyOptions()).toHaveLength(7);
  });

  it('a SET keeps reporting the applied option while pending, then settles on the new one', async () => {
    const d = await head();
    await d.setOutputLatency(4);
    const during = await d.getOutputLatencyStatus();
    expect(during).toMatchObject({ pending: true, requestedId: 5, effectiveId: 5, effectiveUs: 4000, targetFrames: 192 });
    const st = await settled(d);
    expect(st).toMatchObject({ requestedId: 4, effectiveId: 4, effectiveUs: 3000, pending: false });
  });

  it('STALLs unknown ids and treats re-sending the stored id as a no-op', async () => {
    const d = await head();
    await expect(d.setOutputLatency(99)).rejects.toThrow();
    await d.setOutputLatency(5);
    expect((await d.getOutputLatencyStatus()).pending).toBe(false);
    expect((await d.getOutputLatencyStatus()).requestedId).toBe(5);
  });

  it('a stream-only request on a USB source runs as the 2 ms option', async () => {
    const d = await head();
    await d.setOutputLatency(1);
    const st = await settled(d);
    expect(st).toMatchObject({ requestedId: 1, effectiveId: 3, effectiveUs: 2000 });
    const opts = await d.getOutputLatencyOptions();
    const byId = new Map(opts.map((o) => [o.id, o]));
    expect(byId.get(1)).toMatchObject({ streamOnly: true, available: false, effectiveUs: 2000 });
    expect(byId.get(3)).toMatchObject({ streamOnly: false, available: true });
  });

  it('a stream-only option is available and runs as itself on a stream input', async () => {
    const d = await head();
    await d.setInputSource(Domain.AudioInputSource.Spdif);
    await d.setOutputLatency(2);
    const st = await settled(d);
    expect(st).toMatchObject({ requestedId: 2, effectiveId: 2, effectiveUs: 1000 });
    expect((await d.getOutputLatencyOptions()).find((o) => o.id === 2)?.available).toBe(true);
  });

  it('a reply shorter than the status block is rejected, so the probe reads as unsupported', async () => {
    const inner = new MockTransport({ platform: 'rp2350', fwHead: true });
    await inner.open();
    const d = await DspDevice.create({
      open: () => inner.open(), close: () => inner.close(), isOpen: () => inner.isOpen(),
      on: (e, l) => inner.on(e, l),
      ctrlIn: async (req, value, length) => {
        const r = await inner.ctrlIn(req, value, length);
        return req === Protocol.WireCmd.OutputLatency.code && value === Protocol.Wire.OUTPUT_LATENCY_GET_STATUS ? r.slice(0, 4) : r;
      },
      ctrlOut: (req, value, data) => inner.ctrlOut(req, value, data),
    });
    await expect(d.getOutputLatencyStatus()).rejects.toThrow(/too short/);
  });

  it('older firmware STALLs the opcode', async () => {
    const d = await beta4();
    await expect(d.getOutputLatencyStatus()).rejects.toThrow();
    await expect(d.setOutputLatency(3)).rejects.toThrow();
  });
});

describe('ring health (status 26-31)', () => {
  it('reads all six counters on the head profile', async () => {
    const h = await (await head()).getRingHealth();
    expect(Object.keys(h)).toHaveLength(6);
    expect(Object.values(h).every((v) => v !== null)).toBe(true);
  });

  it('a rejected read leaves that field null and the rest populated', async () => {
    const inner = new MockTransport({ platform: 'rp2350', fwHead: true });
    await inner.open();
    const d = await DspDevice.create({
      open: () => inner.open(), close: () => inner.close(), isOpen: () => inner.isOpen(),
      on: (e, l) => inner.on(e, l),
      ctrlIn: (req, value, length) => value === Protocol.SystemStatusValue.RingLowestFill
        ? Promise.reject(new Error('stall')) : inner.ctrlIn(req, value, length),
      ctrlOut: (req, value, data) => inner.ctrlOut(req, value, data),
    });
    const h = await d.getRingHealth();
    expect(h.lowestFillFrames).toBeNull();
    expect(h.inputGapWorstUs).not.toBeNull();
  });
});

describe('background CS revert', () => {
  it('completes within the revert budget although status reads PENDING for several polls', async () => {
    const d = await head();
    const { result, status } = await d.csRevert();
    expect(result.ok).toBe(true);
    expect(status.lastSlot).toBe(0xFF);
  });

  it('keeps polling a slow revert past the shared apply budget', async () => {
    const inner = new MockTransport({ platform: 'rp2350', fwHead: true });
    await inner.open();
    let slowReads = 60;   // well past the 25-poll apply budget
    const d = await DspDevice.create({
      open: () => inner.open(), close: () => inner.close(), isOpen: () => inner.isOpen(),
      on: (e, l) => inner.on(e, l),
      ctrlIn: async (req, value, length) => {
        const r = await inner.ctrlIn(req, value, length);
        if (req === Protocol.WireCmd.GetCsStatus.code && slowReads-- > 0) {
          const out = r.slice();
          out[0] = Protocol.CsStatusCode.Pending;
          out[1] = 0xFF;
          return out;
        }
        return r;
      },
      ctrlOut: (req, value, data) => inner.ctrlOut(req, value, data),
    });
    vi.useFakeTimers();
    try {
      const pending = d.csRevert();
      await vi.advanceTimersByTimeAsync(3000);
      expect((await pending).result.ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('macro fire and IR learn arm during a revert report BUSY, not a bad slot / missing IR', async () => {
    const raw = new MockTransport({ platform: 'rp2350', fwHead: true });
    const d = await DspDevice.create(raw);
    await Protocol.actionCmd(raw, Protocol.WireCmd.CsRevert);
    const fire = await d.csMacroFire(0);
    expect(fire.ok).toBe(false);
    if (!fire.ok) expect(fire.code).toBe(Protocol.CsStatusCode.Busy);
    const arm = await d.csIrLearnArm();
    expect(arm.ok).toBe(false);
    if (!arm.ok) expect(arm.code).toBe(Protocol.CsStatusCode.Busy);
  });

  it('an out-of-range macro still reports an invalid macro once no revert runs', async () => {
    const d = await head();
    const fire = await d.csMacroFire(200);
    expect(fire.ok).toBe(false);
    if (!fire.ok) expect(fire.code).toBe(Protocol.CsStatusCode.InvalidMacro);
  });
});

describe('mock CS caps catalog', () => {
  it('the head profile serves caps v21 with nouns up to PRESET_SAVE', async () => {
    const { caps, nouns } = await (await head()).getCsCaps();
    expect(caps.capsVersion).toBe(21);
    expect(nouns).toHaveLength(80);
    expect(nouns[79]).toMatchObject({ kind: Domain.CsKind.Bool, targetKind: 0 });
  });

  it('an older simulated capsVersion hides nouns added later', async () => {
    const d = await DspDevice.create(new MockTransport({ platform: 'rp2350', fwHead: true, csCapsVersion: 19 }));
    expect((await d.getCsCaps()).nouns).toHaveLength(74);
  });
});
