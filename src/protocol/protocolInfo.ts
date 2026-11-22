// Paged-protocol discovery (firmware 1.1.7+). A command ID is 16 bits,
// (page << 8) | command number. Legacy firmware ignores the page byte, so the
// first request on any connection must be this probe: paged firmware answers
// with PROTOCOL_INFO, legacy firmware STALLs (no IN handler at 0x10).

import { TransportStall } from '@/transport/DspTransport';
import * as Gen from './paged.gen';

export const PAGED_PROTOCOL_INFO = Gen.PagedCmd.SYS.PROTOCOL_INFO.id;
export const PROTOCOL_INFO_LENGTH = Gen.PagedCmd.SYS.PROTOCOL_INFO.getLen;

// The paged protocol major this console understands. Kept literal so a
// re-vendored registry cannot change it silently (pagedRegistry.test.ts).
export const SUPPORTED_PROTOCOL_MAJOR = 1;

const MAGIC = [0x44, 0x53, 0x50, 0x69]; // "DSPi"

export interface ProtocolInfo {
  major: number;
}

// Null when the reply is not a PROTOCOL_INFO (wrong magic or too short).
export function parseProtocolInfo(bytes: Uint8Array): ProtocolInfo | null {
  if (bytes.length < 5) return null;
  if (!MAGIC.every((b, i) => bytes[i] === b)) return null;
  return { major: bytes[4] };
}

// A control STALL. Chromium's WinUSB backend reports it as a thrown
// NetworkError rather than status 'stall'.
export function isStall(err: unknown): boolean {
  return err instanceof TransportStall || (err instanceof Error && err.name === 'NetworkError');
}

// A probe failure that identifies legacy firmware. Falling back to legacy is
// the safe direction: paged firmware refuses page-0 requests and changes
// nothing.
export const isLegacyProbeRefusal = isStall;
