import * as Secrets from './secrets';
import type { ClientMessage, Sdp } from '../src/runtime/remote/relayWire';

export type { ByeReason, ClientMessage, ErrorCode, Sdp, SdpType, ServerMessage } from '../src/runtime/remote/relayWire';

export const MAX_MESSAGE_CHARS = 32 * 1024;
const MAX_FIELD_CHARS = 128;
const MAX_LABEL_CHARS = 64;

function field(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_FIELD_CHARS;
}

function sdpOf(value: unknown): Sdp | null {
  if (typeof value !== 'object' || value === null) return null;
  const { type, sdp } = value as Record<string, unknown>;
  if (type !== 'offer' && type !== 'answer') return null;
  if (typeof sdp !== 'string' || sdp.length === 0 || sdp.length > MAX_MESSAGE_CHARS) return null;
  return { type, sdp };
}

function cleanLabel(label: string): string {
  const printable = [...label].filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127).join('').trim();
  return printable || 'unknown';
}

/** Returns null for anything that is not a well-formed client message. */
export function parseClient(raw: string): ClientMessage | null {
  if (raw.length > MAX_MESSAGE_CHARS) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const m = data as Record<string, unknown>;
  switch (m.t) {
    case 'host':
      return field(m.token) ? { t: 'host', token: m.token } : null;
    case 'join': {
      if (m.label !== undefined && (typeof m.label !== 'string' || m.label.length > MAX_LABEL_CHARS)) return null;
      const label = cleanLabel((m.label as string | undefined) ?? '');
      if (m.resume !== undefined) {
        if (!field(m.resume) || m.code !== undefined || m.scanKey !== undefined) return null;
        return { t: 'join', resume: m.resume, label };
      }
      if (typeof m.code !== 'string' || !Secrets.isCode(m.code)) return null;
      if (m.scanKey === undefined) return { t: 'join', code: m.code, label };
      return field(m.scanKey) ? { t: 'join', code: m.code, scanKey: m.scanKey, label } : null;
    }
    case 'sdp': {
      const sdp = sdpOf(m.sdp);
      if (!sdp) return null;
      if (m.peerId === undefined) return { t: 'sdp', sdp };
      return field(m.peerId) ? { t: 'sdp', sdp, peerId: m.peerId } : null;
    }
    case 'ping':
      return { t: 'ping' };
    case 'allow':
    case 'deny':
    case 'busy':
      return field(m.peerId) ? { t: m.t, peerId: m.peerId } : null;
    case 'bye':
      return m.reason === 'no-path' ? { t: 'bye', reason: m.reason } : null;
    case 'lent':
      return typeof m.on === 'boolean' ? { t: 'lent', on: m.on } : null;
    case 'rotate':
    case 'reclaim':
    case 'close':
      return { t: m.t };
    default:
      return null;
  }
}
