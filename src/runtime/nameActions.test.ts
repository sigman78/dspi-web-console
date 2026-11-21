import { describe, it, expect, afterEach, vi } from 'vitest';
import { bootMock } from './boot';
import { setInputSourceName, setDeviceName } from './nameActions';
import { MockTransport } from '@/transport/MockTransport';
import * as State from '@/state';
import { Wire } from '@/protocol';

afterEach(() => {
  vi.restoreAllMocks();
  for (const rec of State.sessionRecords().values()) rec.session.dispose();
  State.resetAppState();
});

const nameWrites = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter(([req]) => req === 0x54 || req === 0x56);

describe('name actions', () => {
  it('writes a sanitized name and caches what the device stored', async () => {
    await bootMock('rp2350', { wireVersion: Wire.MAX_WIRE_VERSION, fw116Release: true });
    const s = State.activeSession()!;
    expect(await setInputSourceName(s, 1, 'Caf\u00e9 TV')).toBe(true);
    expect(await setDeviceName(s, 'Den')).toBe(true);
    expect(s.names.inputSources[1]).toBe('Caf TV');
    expect(s.names.device).toBe('Den');
    expect(await s.device.getInputSourceName(1)).toBe('Caf TV');
  });

  it('refuses a source the device cannot select', async () => {
    await bootMock('rp2040', { wireVersion: Wire.MAX_WIRE_VERSION, fw116Release: true });
    const s = State.activeSession()!;
    const out = vi.spyOn(MockTransport.prototype, 'ctrlOut');
    expect(await setInputSourceName(s, 3, 'ADAT box')).toBe(false);
    expect(await setInputSourceName(s, 42, 'x')).toBe(false);
    expect(nameWrites(out)).toHaveLength(0);
  });

  it('on legacy firmware puts nothing on the wire and caches nothing', async () => {
    await bootMock('rp2350', { wireVersion: 32 });
    const s = State.activeSession()!;
    const out = vi.spyOn(MockTransport.prototype, 'ctrlOut');
    expect(await setInputSourceName(s, 1, 'TV')).toBe(false);
    expect(await setDeviceName(s, 'Den')).toBe(false);
    expect(nameWrites(out)).toHaveLength(0);
    expect(s.names.inputSources).toEqual({});
    expect(s.names.device).toBe('');
  });
});
