import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SvelteSet } from 'svelte/reactivity';
import { parseBulkParams } from '../protocol/bulkParser';
import { synthesizeBulkParams } from '../protocol/bulkParser.syn';
import { PlatformType } from '../domain/platform';
import { fromBulkParams } from '../domain/bulkToSnapshot';
import { createHardwareProfile } from '../domain/hardware';
import type { DspDevice } from '../device/DspDevice';
import { bindDevice, session, setStatus } from '../state/session.svelte';
import { dsp, patchSnapshot } from '../state/dsp.svelte';
import { instantCommand, scrubCommand, batchCommand, cancelAllCommands } from './commands';

const testHardware = createHardwareProfile(PlatformType.RP2350);

function initializedDevice(methods: Partial<DspDevice>): DspDevice {
  return {
    info: {
      serial: 'TEST-RP2350',
      firmwareVersion: '1.0.0',
      platformType: PlatformType.RP2350,
      hardware: testHardware,
    },
    hardware: testHardware,
    ...methods,
  } as DspDevice;
}

function makeDevice(send: () => Promise<void> = async () => {}) {
  const validBulk = parseBulkParams(synthesizeBulkParams({ formatVersion: 6 }));
  return initializedDevice({
    setLoudnessEnabled: vi.fn(send),
    getAllParams: vi.fn(async () => validBulk),
  });
}

describe('instantCommand', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const bulk = parseBulkParams(synthesizeBulkParams({ formatVersion: 6 }));
    dsp.live = fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk);
    dsp.pendingWrites = new SvelteSet();
    // Reset session status so leaked 'error' from a prior test in the suite
    // does not pollute assertions in tests that don't explicitly set status.
    setStatus('idle');
  });
  afterEach(() => {
    vi.useRealTimers();
    bindDevice(null);
  });

  it('applies optimistic patch synchronously', () => {
    bindDevice(makeDevice());
    let applied = false;
    instantCommand({
      apply: () => { applied = true; patchSnapshot({ masterVolumeDb: -7 }); },
      send: async () => {},
    });
    expect(applied).toBe(true);
    expect(dsp.live?.masterVolumeDb).toBe(-7);
  });

  it('marks pending while in flight, clears on success', async () => {
    bindDevice(makeDevice());
    instantCommand({
      apply: () => {},
      send: async (d) => { await d.setLoudnessEnabled(true); },
    });
    expect(dsp.pendingWrites.size).toBe(1);
    await vi.runAllTimersAsync();
    expect(dsp.pendingWrites.size).toBe(0);
  });

  it('forces resync + sets error status on failure', async () => {
    bindDevice(makeDevice(async () => { throw new Error('range'); }));
    instantCommand({
      apply: () => {},
      send: async (d) => { await d.setLoudnessEnabled(true); },
    });
    await vi.runAllTimersAsync();
    expect(session.status).toBe('error');
    expect(dsp.pendingWrites.size).toBe(0);
  });

  it('stale generation does not flip session status to error', async () => {
    bindDevice(makeDevice(async () => { throw new Error('range'); }));
    instantCommand({
      apply: () => {},
      send: async (d) => { await d.setLoudnessEnabled(true); },
    });
    // simulate a reconnect mid-flight: generation advances
    session.generation += 1;
    await vi.runAllTimersAsync();
    expect(session.status).not.toBe('error');
  });

  it('no-op when no device is bound', () => {
    bindDevice(null);
    const apply = vi.fn();
    instantCommand({ apply, send: async () => {} });
    // apply still runs (optimistic) but pending stays empty (no send fired)
    expect(apply).toHaveBeenCalled();
    expect(dsp.pendingWrites.size).toBe(0);
  });
});

function makeGainDevice() {
  const calls: Array<[number, number]> = [];
  const validBulk = parseBulkParams(synthesizeBulkParams({ formatVersion: 6 }));
  return {
    device: initializedDevice({
      setOutputGain: vi.fn(async (output: number, db: number) => { calls.push([output, db]); }),
      getAllParams: vi.fn(async () => validBulk),
    }),
    calls,
  };
}

describe('scrubCommand', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const bulk = parseBulkParams(synthesizeBulkParams({ formatVersion: 6 }));
    dsp.live = fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk);
    dsp.pendingWrites = new SvelteSet();
    // Reset session status so leaked 'error' from a prior test in the suite
    // does not pollute assertions in tests that don't explicitly set status.
    setStatus('idle');
    // Drop any module-scoped lanes left over from prior tests so each test
    // starts with a clean per-key registry.
    cancelAllCommands();
  });
  afterEach(() => {
    cancelAllCommands();
    vi.useRealTimers();
    bindDevice(null);
  });

  it('applies optimistic patch on every call', () => {
    bindDevice(makeGainDevice().device);
    const seen: number[] = [];
    for (const v of [-3, -6, -9]) {
      scrubCommand({
        key: 'outputGain:0',
        apply: () => { seen.push(v); },
        send: async () => {},
      });
    }
    expect(seen).toEqual([-3, -6, -9]);
  });

  it('coalesces a burst on one key to a single send of the latest payload', async () => {
    const { device, calls } = makeGainDevice();
    bindDevice(device);
    for (const v of [-3, -6, -9]) {
      scrubCommand({
        key: 'outputGain:0',
        apply: () => {},
        send: async (d) => { await d.setOutputGain(0, v); },
      });
    }
    await vi.runAllTimersAsync();
    expect(calls).toEqual([[0, -9]]);
  });

  it('different keys do not cannibalize each other', async () => {
    const { device, calls } = makeGainDevice();
    bindDevice(device);
    scrubCommand({
      key: 'outputGain:0',
      apply: () => {},
      send: async (d) => { await d.setOutputGain(0, -3); },
    });
    scrubCommand({
      key: 'outputGain:1',
      apply: () => {},
      send: async (d) => { await d.setOutputGain(1, -6); },
    });
    await vi.runAllTimersAsync();
    expect(calls).toEqual(expect.arrayContaining([[0, -3], [1, -6]]));
    expect(calls).toHaveLength(2);
  });

  it('clears pending after a successful flush', async () => {
    const { device } = makeGainDevice();
    bindDevice(device);
    scrubCommand({
      key: 'outputGain:0',
      apply: () => {},
      send: async (d) => { await d.setOutputGain(0, -3); },
    });
    expect(dsp.pendingWrites.size).toBeGreaterThan(0);
    await vi.runAllTimersAsync();
    expect(dsp.pendingWrites.size).toBe(0);
  });

  it('forces resync + sets error on send failure (current generation)', async () => {
    const validBulk = parseBulkParams(synthesizeBulkParams({ formatVersion: 6 }));
    const device = initializedDevice({
      setOutputGain: vi.fn(async () => { throw new Error('range'); }),
      getAllParams: vi.fn(async () => validBulk),
    });
    bindDevice(device);
    scrubCommand({
      key: 'outputGain:0',
      apply: () => {},
      send: async (d) => { await d.setOutputGain(0, -3); },
    });
    await vi.runAllTimersAsync();
    expect(session.status).toBe('error');
  });
});

describe('batchCommand', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const bulk = parseBulkParams(synthesizeBulkParams({ formatVersion: 6 }));
    dsp.live = fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk);
    dsp.pendingWrites = new SvelteSet();
    // Reset session status so leaked 'error' from a prior test in the suite
    // does not pollute assertions in tests that don't explicitly set status.
    setStatus('idle');
  });
  afterEach(() => {
    vi.useRealTimers();
    bindDevice(null);
  });

  it('runs apply once and tracks one pending token across the whole send', async () => {
    const { device, calls } = makeGainDevice();
    bindDevice(device);
    let pendingDuringSend = -1;
    batchCommand({
      apply: () => { patchSnapshot({ masterVolumeDb: -1 }); },
      send: async (d) => {
        pendingDuringSend = dsp.pendingWrites.size;
        await d.setOutputGain(0, -1);
        await d.setOutputGain(1, -1);
      },
    });
    expect(dsp.live?.masterVolumeDb).toBe(-1);
    expect(dsp.pendingWrites.size).toBe(1);
    await vi.runAllTimersAsync();
    expect(pendingDuringSend).toBe(1);
    expect(calls).toEqual([[0, -1], [1, -1]]);
    expect(dsp.pendingWrites.size).toBe(0);
  });

  it('forces resync + sets error if any wire write inside the batch rejects', async () => {
    const validBulk = parseBulkParams(synthesizeBulkParams({ formatVersion: 6 }));
    const device = initializedDevice({
      setOutputGain: vi.fn(async (output: number) => {
        if (output === 1) throw new Error('boom');
      }),
      getAllParams: vi.fn(async () => validBulk),
    });
    bindDevice(device);
    batchCommand({
      apply: () => {},
      send: async (d) => {
        await d.setOutputGain(0, -1);
        await d.setOutputGain(1, -1);
      },
    });
    await vi.runAllTimersAsync();
    expect(session.status).toBe('error');
  });

  it('stale generation does not flip session status to error', async () => {
    const validBulk = parseBulkParams(synthesizeBulkParams({ formatVersion: 6 }));
    const device = initializedDevice({
      setOutputGain: vi.fn(async () => { throw new Error('boom'); }),
      getAllParams: vi.fn(async () => validBulk),
    });
    bindDevice(device);
    batchCommand({
      apply: () => {},
      send: async (d) => { await d.setOutputGain(0, -1); },
    });
    // simulate a reconnect mid-flight: generation advances
    session.generation += 1;
    await vi.runAllTimersAsync();
    expect(session.status).not.toBe('error');
  });

  it('no-op when no device is bound', () => {
    bindDevice(null);
    const apply = vi.fn();
    batchCommand({ apply, send: async () => {} });
    // apply still runs (optimistic) but pending stays empty (no send fired)
    expect(apply).toHaveBeenCalled();
    expect(dsp.pendingWrites.size).toBe(0);
  });
});

describe('cancelAllCommands', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const bulk = parseBulkParams(synthesizeBulkParams({ formatVersion: 6 }));
    dsp.live = fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk);
    dsp.pendingWrites = new SvelteSet();
  });
  afterEach(() => {
    vi.useRealTimers();
    bindDevice(null);
  });

  it('drops queued scrub timers and clears pending lane tokens', async () => {
    const { device, calls } = makeGainDevice();
    bindDevice(device);
    scrubCommand({
      key: 'outputGain:0',
      apply: () => {},
      send: async (d) => { await d.setOutputGain(0, -3); },
    });
    expect(dsp.pendingWrites.size).toBe(1);

    cancelAllCommands();
    expect(dsp.pendingWrites.size).toBe(0);

    await vi.runAllTimersAsync();
    expect(calls).toEqual([]);
  });

  it('bumps session generation so in-flight instant sends settle as stale', async () => {
    let resolveSend: () => void = () => {};
    const validBulk = parseBulkParams(synthesizeBulkParams({ formatVersion: 6 }));
    const device = initializedDevice({
      setLoudnessEnabled: vi.fn(() => new Promise<void>((res) => { resolveSend = res; })),
      getAllParams: vi.fn(async () => validBulk),
    });
    bindDevice(device);

    instantCommand({
      apply: () => {},
      send: async (d) => { await d.setLoudnessEnabled(true); },
    });
    expect(dsp.pendingWrites.size).toBe(1);

    cancelAllCommands();
    expect(dsp.pendingWrites.size).toBe(0);
    expect(session.status).not.toBe('error');

    // Resolve the in-flight send. It should NOT trigger scheduleResync
    // because gen !== session.generation now. Status must stay clean.
    resolveSend();
    await vi.runAllTimersAsync();
    expect(session.status).not.toBe('error');
  });

  it('in-flight instant rejection after cancel does NOT flip status to error', async () => {
    let rejectSend: (err: Error) => void = () => {};
    const validBulk = parseBulkParams(synthesizeBulkParams({ formatVersion: 6 }));
    const device = initializedDevice({
      setLoudnessEnabled: vi.fn(() => new Promise<void>((_, rej) => { rejectSend = rej; })),
      getAllParams: vi.fn(async () => validBulk),
    });
    bindDevice(device);

    instantCommand({
      apply: () => {},
      send: async (d) => { await d.setLoudnessEnabled(true); },
    });
    expect(dsp.pendingWrites.size).toBe(1);

    cancelAllCommands();
    expect(session.status).not.toBe('error');

    // Reject the in-flight send AFTER cancel. The catch branch must observe
    // gen !== session.generation and skip setStatus('error', ...).
    rejectSend(new Error('post-cancel rejection'));
    await vi.runAllTimersAsync();
    expect(session.status).not.toBe('error');
  });
});
