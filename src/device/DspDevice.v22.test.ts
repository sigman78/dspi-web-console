// V22 (Linkwitz Transform qp sidecar) device-facade coverage: the 18-byte
// SetEqParam write for LT bands, the param-5 GetEqParam qp read, and the
// setFilter/getFilter round trip against the MockTransport synthesis.

import { describe, it, expect } from 'vitest';
import { MockTransport } from '@/transport/MockTransport';
import { DspDevice } from './DspDevice';
import { createDevice } from '@test/fixtures/deviceHarness';
import { WireCmd } from '@/protocol';
import { ChannelId, FilterType } from '@/domain';
import type { DspTransport } from '@/transport/DspTransport';

const FW_115 = { major: 1, minor: 1, patch: 5 };

async function v22Device(): Promise<DspDevice> {
  return DspDevice.create(new MockTransport({ platform: 'rp2350', wireVersion: 22, fwVersion: FW_115 }));
}

describe('DspDevice — setFilter LT write shape', () => {
  it('sends the 18-byte form (qp sidecar) for a Linkwitz Transform band', async () => {
    const seenOut: { req: number; data: Uint8Array }[] = [];
    const t: DspTransport = {
      open: async () => {}, close: async () => {}, isOpen: () => true, on: () => () => {},
      ctrlIn: async (req, _val, len) => (req === WireCmd.GetPlatform.code ? new Uint8Array([1, 1, 2, 0]) : new Uint8Array(len)),
      ctrlOut: async (req, _val, data) => { seenOut.push({ req, data: new Uint8Array(data) }); },
    };
    const d = await createDevice(t);
    await d.setFilter(2, 3, { type: FilterType.LinkwitzTransform, bypass: false, frequency: 45, q: 0.6, gain: 90, qp: 1.5 });

    const call = seenOut.find((c) => c.req === WireCmd.SetEqParam.code);
    expect(call?.data.byteLength).toBe(18);
    // qp = round(1.5*512) = 768, little-endian at bytes 16-17.
    const qpRaw = call!.data[16] | (call!.data[17] << 8);
    expect(qpRaw).toBe(768);
  });

  it('sends the plain 16-byte form for every other type (no qp sidecar)', async () => {
    const seenOut: { req: number; data: Uint8Array }[] = [];
    const t: DspTransport = {
      open: async () => {}, close: async () => {}, isOpen: () => true, on: () => () => {},
      ctrlIn: async (req, _val, len) => (req === WireCmd.GetPlatform.code ? new Uint8Array([1, 1, 2, 0]) : new Uint8Array(len)),
      ctrlOut: async (req, _val, data) => { seenOut.push({ req, data: new Uint8Array(data) }); },
    };
    const d = await createDevice(t);
    await d.setFilter(2, 3, { type: FilterType.Peaking, bypass: false, frequency: 1000, q: 1, gain: 3 });

    const call = seenOut.find((c) => c.req === WireCmd.SetEqParam.code);
    expect(call?.data.byteLength).toBe(16);
  });

  it('defaults qp to 0.707 (QP_DEFAULT) when the caller omits it', async () => {
    const seenOut: { req: number; data: Uint8Array }[] = [];
    const t: DspTransport = {
      open: async () => {}, close: async () => {}, isOpen: () => true, on: () => () => {},
      ctrlIn: async (req, _val, len) => (req === WireCmd.GetPlatform.code ? new Uint8Array([1, 1, 2, 0]) : new Uint8Array(len)),
      ctrlOut: async (req, _val, data) => { seenOut.push({ req, data: new Uint8Array(data) }); },
    };
    const d = await createDevice(t);
    await d.setFilter(2, 3, { type: FilterType.LinkwitzTransform, bypass: false, frequency: 45, q: 0.6, gain: 90 });

    const call = seenOut.find((c) => c.req === WireCmd.SetEqParam.code);
    const qpRaw = call!.data[16] | (call!.data[17] << 8);
    expect(qpRaw).toBe(Math.round(0.707 * 512));
  });
});

describe('DspDevice — LT round trip against MockTransport (V22+)', () => {
  it('setFilter -> getFilter cross-validates qp through the granular multi-read protocol', async () => {
    const d = await v22Device();
    await d.setFilter(ChannelId.In1L, 2, {
      type: FilterType.LinkwitzTransform, bypass: false, frequency: 42, q: 0.65, gain: 55, qp: 2,
    });
    const got = await d.getFilter(ChannelId.In1L, 2);
    expect(got.type).toBe(FilterType.LinkwitzTransform);
    expect(got.frequency).toBeCloseTo(42, 3);
    expect(got.q).toBeCloseTo(0.65, 4);
    expect(got.gain).toBeCloseTo(55, 3);   // fp in Hz, carried in the gain slot
    expect(got.qp).toBeCloseTo(2, 3);
  });

  it('omits qp from getFilter for a non-LT band', async () => {
    const d = await v22Device();
    await d.setFilter(ChannelId.In1L, 2, { type: FilterType.Peaking, bypass: false, frequency: 1000, q: 1, gain: 3 });
    const got = await d.getFilter(ChannelId.In1L, 2);
    expect(got.qp).toBeUndefined();
  });

  it('re-typing a band away from LT forces its stored qp to 0', async () => {
    const d = await v22Device();
    await d.setFilter(ChannelId.In1L, 2, {
      type: FilterType.LinkwitzTransform, bypass: false, frequency: 42, q: 0.65, gain: 55, qp: 3,
    });
    await d.setFilter(ChannelId.In1L, 2, { type: FilterType.Peaking, bypass: false, frequency: 500, q: 1, gain: 0 });
    const bulk = await d.getAllParams();
    expect(bulk.filters[0][2].qpRaw).toBe(0);
  });

  it('exposes linkwitzTransform as a V22+ capability', async () => {
    const d = await v22Device();
    expect(d.capabilities.features.linkwitzTransform).toBe(true);
  });
});
