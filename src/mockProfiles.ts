// Resolves the raw ?mock token (see src/devOptions.ts) into a concrete mock
// boot config. Split out of devOptions.ts because it needs the Wire version bounds,
// and devOptions.ts must stay import-free (src/utils/log.ts depends on it).
import * as Wire from '@/protocol/wireTypes';
import { mockToken, mockChip, mockSysClockFallback, mockSysClockOff, mockCsFull } from './devOptions';
import type { MockOptions } from '@/transport/MockTransport';

export interface MockProfile {
  name: string;
  platform: MockOptions['platform'];
  opts: Omit<MockOptions, 'platform'>;
}

const FW_1_1_5 = { major: 1, minor: 1, patch: 5 } as const;
const FW_1_1_6 = { major: 1, minor: 1, patch: 6 } as const;
// Wire V30 exists only in the 1.1.6-beta3 line, and that tag is also what
// carries the pre-release ordinal, so a V30 mock reports "1.1.6 beta 3" the
// way a real V30 device does.
const FW_1_1_6_BETA3 = { major: 1, minor: 1, patch: 6, beta: 3 } as const;
// V31/V32 ship in 1.1.6-beta4.
const FW_1_1_6_BETA4 = { major: 1, minor: 1, patch: 6, beta: 4 } as const;
// The release/v1.1.6 branch head still stamps beta 5 but carries far more than
// the beta5 tag; `latest` models the head (MockOptions.fwHead).
const FW_1_1_6_BETA5 = { major: 1, minor: 1, patch: 6, beta: 5 } as const;

// Every profile sets irLearnAutoComplete: an armed IR learn self-completes
// with a fresh NEC code, so the remote-pairing flow is demoable without an IR
// transmitter.

function latest(platform: MockOptions['platform']): MockProfile {
  return {
    name: 'latest',
    platform,
    opts: { wireVersion: Wire.MAX_WIRE_VERSION, fwVersion: FW_1_1_6_BETA5, irLearnAutoComplete: true, fwHead: true },
  };
}

// Firmware version that shipped a given wire version: 1.1.5 for V28, 1.1.6
// for V29, 1.1.6-beta3 for V30 (the first to report a pre-release ordinal),
// and 1.1.6-beta4 for V31-V32 (V31 is an untagged intermediate; it borrows the
// beta4 stamp for lack of a real one).
function fwForWire(n: number): typeof FW_1_1_5 | typeof FW_1_1_6 | typeof FW_1_1_6_BETA3 | typeof FW_1_1_6_BETA4 {
  return n >= 31 ? FW_1_1_6_BETA4 : n >= 30 ? FW_1_1_6_BETA3 : n >= 29 ? FW_1_1_6 : FW_1_1_5;
}

// Control Surfaces capability version of the tagged firmware that shipped a
// wire version: beta3 (V30) reports 18, beta4/beta5 (V32) 20; V31 is an
// untagged intermediate between them. V28/V29 keep the mock default.
function csCapsForWire(n: number): number | undefined {
  return n >= 32 ? 20 : n >= 31 ? 19 : n >= 30 ? 18 : undefined;
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
    case 'multi':
      return {
        name: 'multi',
        platform,
        opts: {
          wireVersion: Wire.MAX_WIRE_VERSION,
          fwVersion: FW_1_1_6_BETA5,
          fwHead: true,
          i2sInputChannels: 8,
          spdifInputsEnabled: 3,
          irLearnAutoComplete: true,
        },
      };
    default: {
      const m = /^v(\d+)$/.exec(token);
      if (m) {
        const n = Number(m[1]);
        if (n >= Wire.MIN_WIRE_VERSION && n <= Wire.MAX_WIRE_VERSION) {
          return {
            name: `v${n}`,
            platform,
            opts: { wireVersion: n, fwVersion: fwForWire(n), csCapsVersion: csCapsForWire(n), irLearnAutoComplete: true },
          };
        }
      }
      return latest(platform);
    }
  }
}

// A comma-separated ?mock token yields one profile per entry (an empty entry
// resolves to `latest`, so `?mock=,v28` works the way it reads). Pure and
// exported for tests.
export function resolveMockProfiles(token: string, chip?: 'rp2040' | 'rp2350' | null): MockProfile[] {
  return token.split(',').map((t) => resolveMockProfile(t.trim(), chip));
}

export function activeMockProfiles(): MockProfile[] | null {
  const token = mockToken();
  if (token === null) return null;
  const profiles = resolveMockProfiles(token, mockChip());
  const fallback = mockSysClockFallback();
  const sysClockOff = mockSysClockOff();
  const csFull = mockCsFull();
  if (!fallback && !sysClockOff && !csFull) return profiles;
  return profiles.map((p) => ({
    ...p,
    opts: {
      ...p.opts,
      ...(fallback ? { sysClockBoot: { storedMode: 2, fallback: true } } : {}),
      ...(sysClockOff ? { sysClock: false } : {}),
      ...(csFull ? { csFull: true } : {}),
    },
  }));
}
