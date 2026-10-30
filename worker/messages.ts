import * as Secrets from './secrets';

export const MAX_MESSAGE_CHARS = 32 * 1024;
const MAX_FIELD_CHARS = 128;
const MAX_LABEL_CHARS = 64;

export type SdpType = 'offer' | 'answer';

export interface Sdp {
  type: SdpType;
  sdp: string;
}

export type ClientMessage =
  | { t: 'host'; token: string }
  | { t: 'join'; code?: string; scanKey?: string; resume?: string; label: string }
  | { t: 'sdp'; sdp: Sdp; peerId?: string }
  | { t: 'ping' }
  | { t: 'allow'; peerId: string }
  | { t: 'deny'; peerId: string }
  | { t: 'rotate' }
  | { t: 'reclaim' }
  | { t: 'close' };

export type ErrorCode = 'bad-code' | 'burnt' | 'expired' | 'rate-limited' | 'no-host' | 'busy';

export type ServerMessage =
  | { t: 'ready'; code: string; scanKey: string }
  | { t: 'peer'; peerId: string; via: 'code' | 'scan' | 'resume'; label: string }
  | { t: 'joined'; needsAllow: boolean; resumeToken?: string }
  | { t: 'allowed'; resumeToken: string }
  | { t: 'peer-gone'; peerId: string }
  | { t: 'pong' }
  | { t: 'denied' }
  | { t: 'sdp'; sdp: Sdp; peerId?: string }
  | { t: 'rotated'; code: string; scanKey: string }
  | { t: 'host-gone' }
  | { t: 'error'; code: ErrorCode };

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
      return field(m.peerId) ? { t: m.t, peerId: m.peerId } : null;
    case 'rotate':
    case 'reclaim':
    case 'close':
      return { t: m.t };
    default:
      return null;
  }
}
