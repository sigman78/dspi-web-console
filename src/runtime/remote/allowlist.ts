// What a remote peer may ask this device to do. B is untrusted input: the
// proxy consults this policy before any transfer reaches the transport.

import { WireCmd } from '@/protocol/wireCmd';

export interface LeasePolicy {
  readOnly: boolean;
  allows(request: number, direction: 'in' | 'out'): boolean;
}

// Reboots into BOOTSEL / wipes all settings: never tunnelled.
const HARD_REFUSED = new Set<number>([WireCmd.EnterBootloader.code, WireCmd.FactoryReset.code]);

// Shared opcodes whose IN direction is a read (SET = OUT, GET = IN).
const READ_ON_IN = new Set<string>(['Limiter']);

const FULL_CODES = new Set<number>();
const READ_ONLY_CODES = new Set<number>();
for (const [name, entry] of Object.entries(WireCmd)) {
  if (HARD_REFUSED.has(entry.code)) continue;
  FULL_CODES.add(entry.code);
  if (name.split(/(?=[A-Z])/).includes('Get') || READ_ON_IN.has(name)) READ_ONLY_CODES.add(entry.code);
}

export function createLeasePolicy(readOnly: boolean): LeasePolicy {
  return {
    readOnly,
    allows: (request, direction) =>
      readOnly
        ? direction === 'in' && READ_ONLY_CODES.has(request)
        : FULL_CODES.has(request),
  };
}
