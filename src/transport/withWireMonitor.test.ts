import { describe, it, expect, vi, afterEach } from 'vitest';
import { Log } from '@/utils';
import type { DspTransport } from './DspTransport';
import { withWireMonitor } from './withWireMonitor';

// Minimal in-memory transport stub. `notify` toggles whether notifyIn exists.
function fakeTransport(opts: { notify?: boolean } = {}): DspTransport {
  const base: DspTransport = {
    open: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    isOpen: vi.fn(() => true),
    on: vi.fn(() => () => {}),
    ctrlIn: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
    ctrlOut: vi.fn(async () => {}),
  };
  if (opts.notify) {
    (base as DspTransport & { notifyIn: unknown }).notifyIn =
      vi.fn(async () => new Uint8Array([0x00]));
  }
  return base;
}

afterEach(() => vi.restoreAllMocks());

describe('withWireMonitor', () => {
  it('passes ctrlIn through and returns the inner bytes unchanged', async () => {
    const inner = fakeTransport();
    const mon = withWireMonitor(inner);
    const out = await mon.ctrlIn(0xd3, 0, 4);
    expect(out).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(inner.ctrlIn).toHaveBeenCalledWith(0xd3, 0, 4);
  });

  it('passes ctrlOut through to the inner transport', async () => {
    const inner = fakeTransport();
    const mon = withWireMonitor(inner);
    const data = new Uint8Array([9]);
    await mon.ctrlOut(0x46, 0, data);
    expect(inner.ctrlOut).toHaveBeenCalledWith(0x46, 0, data);
  });

  it('never lets a logging failure break the transfer', async () => {
    vi.spyOn(Log, 'info').mockImplementation(() => { throw new Error('boom'); });
    const inner = fakeTransport();
    const mon = withWireMonitor(inner);
    await expect(mon.ctrlIn(0xd3, 0, 4)).resolves.toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('never lets a warn-path logging failure break the transfer', async () => {
    vi.spyOn(Log, 'info').mockImplementation(() => { throw new Error('info-boom'); });
    vi.spyOn(Log, 'warn').mockImplementation(() => { throw new Error('warn-boom'); });
    const inner = fakeTransport();
    const mon = withWireMonitor(inner);
    // Both Log.info (success-path) and Log.warn (guard fallback) throw; the
    // transfer must still resolve with the inner bytes.
    await expect(mon.ctrlIn(0xd3, 0, 4)).resolves.toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('logs and rethrows when the inner transfer fails', async () => {
    const warn = vi.spyOn(Log, 'warn').mockImplementation(() => {});
    const inner = fakeTransport();
    (inner.ctrlIn as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('stall'));
    const mon = withWireMonitor(inner);
    await expect(mon.ctrlIn(0xd3, 0, 4)).rejects.toThrow('stall');
    expect(warn).toHaveBeenCalled();
  });

  it('logs telemetry polls at debug and other traffic at info', async () => {
    const info = vi.spyOn(Log, 'info').mockImplementation(() => {});
    const debug = vi.spyOn(Log, 'debug').mockImplementation(() => {});
    const inner = fakeTransport();
    const mon = withWireMonitor(inner);
    await mon.ctrlIn(0x50, 0, 4);   // GetStatus — a telemetry poll
    expect(debug).toHaveBeenCalledTimes(1);
    expect(info).not.toHaveBeenCalled();
    await mon.ctrlIn(0xd3, 0, 4);   // GetMasterVolume — normal traffic
    expect(info).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledTimes(1);
  });

  it('forwards notifyIn when the inner transport exposes it', async () => {
    const mon = withWireMonitor(fakeTransport({ notify: true }));
    expect(typeof mon.notifyIn).toBe('function');
    expect(await mon.notifyIn!(64)).toEqual(new Uint8Array([0x00]));
  });

  it('omits notifyIn when the inner transport lacks it', () => {
    const mon = withWireMonitor(fakeTransport({ notify: false }));
    expect(mon.notifyIn).toBeUndefined();
  });

  it('passes open/close/isOpen/on through', async () => {
    const inner = fakeTransport();
    const mon = withWireMonitor(inner);
    await mon.open();
    await mon.close();
    mon.isOpen();
    mon.on('connect', () => {});
    expect(inner.open).toHaveBeenCalled();
    expect(inner.close).toHaveBeenCalled();
    expect(inner.isOpen).toHaveBeenCalled();
    expect(inner.on).toHaveBeenCalledWith('connect', expect.any(Function));
  });
});
