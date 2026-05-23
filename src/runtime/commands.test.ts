import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SvelteSet } from 'svelte/reactivity';
import { parseBulkParams } from '@/protocol';
import { makeBulk } from '@test/fixtures/bulkFixtures';
import { PlatformType, createHardwareProfile } from '@/domain';
import { fromBulkParams } from '@/device/snapshotCodec';
import type { DspDevice } from '@/device/DspDevice';
import { bindDevice, session, setStatus, dsp } from '@/state';
import { scrubCommand } from './commands';
import { cancelAllCommands } from './outbox';

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

function makeGainDevice() {
  const calls: Array<[number, number]> = [];
  const validBulk = parseBulkParams(makeBulk());
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
    const bulk = parseBulkParams(makeBulk());
    dsp.draft = fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk);
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
    const validBulk = parseBulkParams(makeBulk());
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

describe('cancelAllCommands', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const bulk = parseBulkParams(makeBulk());
    dsp.draft = fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk);
    dsp.pendingWrites = new SvelteSet();
    // Reset session status so a leaked 'error' from a prior test in the suite
    // does not pollute these assertions.
    setStatus('idle');
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

  it('bumps session generation so an in-flight scrub send settles as stale', async () => {
    let resolveSend: () => void = () => {};
    const validBulk = parseBulkParams(makeBulk());
    const device = initializedDevice({
      setOutputGain: vi.fn(() => new Promise<void>((res) => { resolveSend = res; })),
      getAllParams: vi.fn(async () => validBulk),
    });
    bindDevice(device);

    scrubCommand({
      key: 'outputGain:0',
      apply: () => {},
      send: async (d) => { await d.setOutputGain(0, -3); },
    });
    await vi.advanceTimersByTimeAsync(16);   // fire the lane: send is now in flight (parked)
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

  it('an in-flight scrub rejection after cancel does NOT flip status to error', async () => {
    let rejectSend: (err: Error) => void = () => {};
    const validBulk = parseBulkParams(makeBulk());
    const device = initializedDevice({
      setOutputGain: vi.fn(() => new Promise<void>((_, rej) => { rejectSend = rej; })),
      getAllParams: vi.fn(async () => validBulk),
    });
    bindDevice(device);

    scrubCommand({
      key: 'outputGain:0',
      apply: () => {},
      send: async (d) => { await d.setOutputGain(0, -3); },
    });
    await vi.advanceTimersByTimeAsync(16);   // fire the lane: send is now in flight (parked)
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
