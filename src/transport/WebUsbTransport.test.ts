import { describe, it, expect } from 'vitest';
import { DSPI_USB_IDS, matchesDspi } from './WebUsbTransport';

describe('DSPi USB identity', () => {
  it('lists both the legacy (1.1.3) and current (1.1.4) VID/PID pairs', () => {
    expect([...DSPI_USB_IDS]).toEqual([
      { vendorId: 0x2e8a, productId: 0xfeaa },
      { vendorId: 0x2e8b, productId: 0xfeaa },
    ]);
  });

  it('matches a device on either vendor id with the shared product id', () => {
    expect(matchesDspi({ vendorId: 0x2e8a, productId: 0xfeaa })).toBe(true);
    expect(matchesDspi({ vendorId: 0x2e8b, productId: 0xfeaa })).toBe(true);
  });

  it('rejects a foreign vendor or a mismatched product id', () => {
    expect(matchesDspi({ vendorId: 0x1234, productId: 0xfeaa })).toBe(false);
    expect(matchesDspi({ vendorId: 0x2e8b, productId: 0x0001 })).toBe(false);
  });
});
