// Paged-protocol discovery (firmware 1.1.7+). A command ID is 16 bits,
// (page << 8) | command number. Legacy firmware ignores the page byte, so the
// first request on any connection must be this probe: paged firmware answers
// with PROTOCOL_INFO, legacy firmware STALLs (no IN handler at 0x10).

// SYS.PROTOCOL_INFO: page 0x01, command 0x10.
export const PAGED_PROTOCOL_INFO = 0x0110;
export const PROTOCOL_INFO_LENGTH = 16;

// The paged protocol major this console understands.
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
