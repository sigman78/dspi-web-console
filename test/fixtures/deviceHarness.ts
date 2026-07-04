// Shared test harness for constructing a DspDevice over an identity-aware
// transport wrapper. `withIdentity` answers GetSerial/GetPlatform locally so
// tests can plug in custom ctrlIn/ctrlOut stubs without also having to fake
// the connect-time identity reads.

import { DspDevice } from '@/device/DspDevice';
import { makeBulk } from '@test/fixtures/bulkFixtures';
import { WireCmd, Wire } from '@/protocol';
import { PlatformType } from '@/domain';
import type { DspTransport } from '@/transport/DspTransport';

export type TestPlatform = 'rp2040' | 'rp2350';

export function identityBytes(request: number, length: number, platform: TestPlatform): Uint8Array | null {
  if (request === WireCmd.GetSerial.code) {
    const out = new Uint8Array(length);
    out.set(new TextEncoder().encode(`TEST-${platform.toUpperCase()}`).slice(0, length));
    return out;
  }
  if (request === WireCmd.GetPlatform.code) {
    const out = new Uint8Array(length);
    out[0] = platform === 'rp2350' ? PlatformType.RP2350 : PlatformType.RP2040;
    if (length > 1) out[1] = 1;
    if (length > 2) out[2] = 0;
    return out;
  }
  return null;
}

export function withIdentity(base: DspTransport, platform: TestPlatform = 'rp2350'): DspTransport {
  // resolveInfo's connect-time read is the only GetAllParams call this stub
  // needs to answer synthetically, so command-mapping tests connect as
  // supported firmware without a real bulk packet. Later getAllParams()/
  // getSnapshot() calls made through the created device must see live state
  // from the underlying transport, so the injection only fires once.
  let bulkInjected = false;
  return {
    open: () => base.open(),
    close: () => base.close(),
    isOpen: () => base.isOpen(),
    on: (event, listener) => base.on(event, listener),
    ctrlIn: (request, value, length) => {
      const identity = identityBytes(request, length, platform);
      if (identity) return Promise.resolve(identity);
      if (request === WireCmd.GetAllParams.code && !bulkInjected) {
        bulkInjected = true;
        return Promise.resolve(makeBulk(
          { formatVersion: 10, payloadLength: Wire.BulkSizes.V10 },
          { platformId: platform === 'rp2350' ? 1 : 0 },
        ));
      }
      return base.ctrlIn(request, value, length);
    },
    ctrlOut: (request, value, data) => base.ctrlOut(request, value, data),
  };
}

export async function createDevice(base: DspTransport, platform: TestPlatform = 'rp2350'): Promise<DspDevice> {
  const openTransport = base.isOpen() ? async () => {} : () => base.open();
  return DspDevice.create(withIdentity(base, platform), openTransport);
}
