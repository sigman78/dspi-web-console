import { describe, it, expect } from 'vitest';
import { matchesDspi } from './WebUsbTransport';

describe('DSPi USB identity', () => {
  it('matches a device on either vendor id with the shared product id', () => {
    expect(matchesDspi({ vendorId: 0x2e8a, productId: 0xfeaa })).toBe(true);
    expect(matchesDspi({ vendorId: 0x2e8b, productId: 0xfeaa })).toBe(true);
  });

  it('rejects a foreign vendor or a mismatched product id', () => {
    expect(matchesDspi({ vendorId: 0x1234, productId: 0xfeaa })).toBe(false);
    expect(matchesDspi({ vendorId: 0x2e8b, productId: 0x0001 })).toBe(false);
  });
});
