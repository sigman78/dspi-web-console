import { describe, it, expect } from 'vitest';
import { chromeConnectionStatus } from './connectionStatus';

const base = { phase: 'noDevice', connected: false, degraded: false, unsupported: false } as const;

describe('chromeConnectionStatus', () => {
  it('is healthy (ok, pill hidden) only when connected and not degraded', () => {
    const r = chromeConnectionStatus({ ...base, phase: 'ready', connected: true });
    expect(r.tone).toBe('ok');
    expect(r.showPill).toBe(false);
  });

  it('flags a connected-but-degraded link as warn and keeps the pill visible', () => {
    const r = chromeConnectionStatus({ ...base, phase: 'ready', connected: true, degraded: true });
    expect(r.tone).toBe('warn');
    expect(r.showPill).toBe(true);
  });

  it('treats connecting as warn with the pill visible', () => {
    expect(chromeConnectionStatus({ ...base, phase: 'connecting' })).toEqual({ tone: 'warn', showPill: true });
  });

  it('treats errored as err with the pill visible', () => {
    expect(chromeConnectionStatus({ ...base, phase: 'errored' })).toEqual({ tone: 'err', showPill: true });
  });

  it('treats no device as idle with the pill visible', () => {
    expect(chromeConnectionStatus(base)).toEqual({ tone: 'idle', showPill: true });
  });

  it('lets unsupported override an otherwise non-error phase', () => {
    const r = chromeConnectionStatus({ ...base, phase: 'connecting', unsupported: true });
    expect(r.tone).toBe('err');
    expect(r.showPill).toBe(true);
  });
});
