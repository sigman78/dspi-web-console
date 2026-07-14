// Resolves the raw ?mock token (see src/devOptions.ts) into a concrete mock
// boot config. Split out of devOptions.ts because it needs Wire.MAX_WIRE_VERSION,
// and devOptions.ts must stay import-free (src/utils/log.ts depends on it).
import * as Wire from './protocol/wireTypes';
import { mockToken, mockChip } from './devOptions';
import type { MockOptions } from '@/transport/MockTransport';

export interface MockProfile {
  name: string;
  platform: MockOptions['platform'];
  opts: Omit<MockOptions, 'platform'>;
}

const FW_1_1_4 = { major: 1, minor: 1, patch: 4 } as const;
const FW_1_1_5 = { major: 1, minor: 1, patch: 5 } as const;

// Every profile sets irLearnAutoComplete: an armed IR learn self-completes
// with a fresh NEC code, so the remote-pairing flow is demoable without an IR
// transmitter.

function latest(platform: MockOptions['platform']): MockProfile {
  return {
    name: 'latest',
    platform,
    opts: { wireVersion: Wire.MAX_WIRE_VERSION, fwVersion: FW_1_1_5, irLearnAutoComplete: true },
  };
}

// Resolves a raw ?mock token (+ optional &chip flavor) to a profile. Profiles
// are purely functional; the chip axis is orthogonal and combinable with any
// of them. The `rp2040`/`rp2350` tokens are chip shorthands for `latest`
// (kept so historical ?mock=rp2040 links boot the right chip); an explicit
// chip wins over the shorthand. Pure and exported for tests.
export function resolveMockProfile(token: string, chip?: 'rp2040' | 'rp2350' | null): MockProfile {
  const platform = chip ?? (token === 'rp2040' ? 'rp2040' : 'rp2350');
  switch (token) {
    case '':
    case 'latest':
    case 'rp2040':
    case 'rp2350':
      return latest(platform);
    case 'legacy':
      return {
        name: 'legacy',
        platform,
        opts: { wireVersion: 10, fwVersion: FW_1_1_4, irLearnAutoComplete: true },
      };
    case 'multi':
      return {
        name: 'multi',
        platform,
        opts: {
          wireVersion: Wire.MAX_WIRE_VERSION,
          fwVersion: FW_1_1_5,
          i2sInputChannels: 8,
          spdifInputsEnabled: 3,
          irLearnAutoComplete: true,
        },
      };
    default: {
      const m = /^v(\d+)$/.exec(token);
      if (m) {
        const n = Number(m[1]);
        if (n === 10 || (n >= 16 && n <= Wire.MAX_WIRE_VERSION)) {
          return {
            name: `v${n}`,
            platform,
            opts: { wireVersion: n, fwVersion: n === 10 ? FW_1_1_4 : FW_1_1_5, irLearnAutoComplete: true },
          };
        }
      }
      return latest(platform);
    }
  }
}

export function activeMockProfile(): MockProfile | null {
  const token = mockToken();
  return token === null ? null : resolveMockProfile(token, mockChip());
}
