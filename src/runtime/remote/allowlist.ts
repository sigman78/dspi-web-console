// What a remote peer may ask this device to do. B is untrusted input: the
// proxy consults this policy before any transfer reaches the transport.

import { PAGED_PROTOCOL_INFO } from '@/protocol/protocolInfo';
import { WireCmd } from '@/protocol/wireCmd';

export interface LeasePolicy {
  readOnly: boolean;
  allows(cmd: number, direction: 'in' | 'out'): boolean;
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

// The connect probe: a harmless read on every firmware generation, IN only.
// Command IDs are matched whole (16 bits); nothing is masked to a legacy opcode.
export function createLeasePolicy(readOnly: boolean): LeasePolicy {
  return {
    readOnly,
    allows: (cmd, direction) => {
      if (cmd === PAGED_PROTOCOL_INFO) return direction === 'in';
      return readOnly
        ? direction === 'in' && READ_ONLY_CODES.has(cmd)
        : FULL_CODES.has(cmd);
    },
  };
}
