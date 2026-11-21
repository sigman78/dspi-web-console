import { describe, it, expect, afterEach, vi } from 'vitest';
import { peerLabel } from './identity';

afterEach(() => { vi.restoreAllMocks(); });

describe('peerLabel', () => {
  it('has platform, browser and a two-word name, stable across calls', () => {
    const first = peerLabel();
    expect(first.split(' · ')).toHaveLength(3);
    expect(first.split(' · ')[2]).toMatch(/^[a-z]+-[a-z]+$/);
    expect(peerLabel()).toBe(first);
  });

  it('keeps the name across page loads through storage', () => {
    const name = peerLabel().split(' · ')[2];
    expect(JSON.parse(localStorage.getItem('dspi-console-web/remote/v1')!).installId).toMatch(/^[0-9a-f]{8}$/);
    expect(peerLabel().split(' · ')[2]).toBe(name);
  });

  it('still produces a stable label when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const label = peerLabel();
    expect(label.split(' · ')).toHaveLength(3);
    expect(peerLabel()).toBe(label);
  });

  it('never exceeds the relay label limit and keeps the name', () => {
    const name = peerLabel().split(' · ')[2];
    Object.defineProperty(navigator, 'userAgentData', {
      configurable: true,
      value: { platform: 'P'.repeat(100), brands: [] },
    });
    try {
      const label = peerLabel();
      expect(label.length).toBeLessThanOrEqual(64);
      expect(label.endsWith(name)).toBe(true);
    } finally {
      Reflect.deleteProperty(navigator, 'userAgentData');
    }
  });

  it('prefers userAgentData and falls back to the user agent string', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0 Safari/537.36');
    expect(peerLabel()).toMatch(/^Linux · Chrome · /);
    Object.defineProperty(navigator, 'userAgentData', {
      configurable: true,
      value: { platform: 'Windows', brands: [{ brand: 'Not A Brand' }, { brand: 'Microsoft Edge' }, { brand: 'Chromium' }] },
    });
    try {
      expect(peerLabel()).toMatch(/^Windows · Edge · /);
    } finally {
      Reflect.deleteProperty(navigator, 'userAgentData');
    }
  });
});
