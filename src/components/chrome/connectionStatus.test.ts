import { describe, it, expect } from 'vitest';
import { chromeConnectionStatus } from './connectionStatus';

const base = { phase: 'noDevice', connected: false, degraded: false, unsupported: false } as const;

describe('chromeConnectionStatus', () => {
  it('is healthy (ok) only when connected and not degraded', () => {
    const r = chromeConnectionStatus({ ...base, phase: 'ready', connected: true });
    expect(r.tone).toBe('ok');
  });

  it('flags a connected-but-degraded link as warn', () => {
    const r = chromeConnectionStatus({ ...base, phase: 'ready', connected: true, degraded: true });
    expect(r.tone).toBe('warn');
  });

  it('treats connecting as warn', () => {
    expect(chromeConnectionStatus({ ...base, phase: 'connecting' })).toEqual({ tone: 'warn' });
  });

  it('treats errored as err', () => {
    expect(chromeConnectionStatus({ ...base, phase: 'errored' })).toEqual({ tone: 'err' });
  });

  it('treats no device as idle', () => {
    expect(chromeConnectionStatus(base)).toEqual({ tone: 'idle' });
  });

  it('lets unsupported override an otherwise non-error phase', () => {
    const r = chromeConnectionStatus({ ...base, phase: 'connecting', unsupported: true });
    expect(r.tone).toBe('err');
  });
});
