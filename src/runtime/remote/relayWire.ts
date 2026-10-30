// Message shapes of the pairing relay, shared with the Worker (worker/messages.ts
// validates the client side at runtime). Types and constants only: this file is
// compiled by both the SPA and the Worker projects.

export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 6;

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
  // Turns the guest away as busy, leaving its token, the Allow state and the code alone.
  | { t: 'busy'; peerId: string }
  | { t: 'rotate' }
  | { t: 'reclaim' }
  | { t: 'lent'; on: boolean }
  | { t: 'bye'; reason: ByeReason }
  | { t: 'close' };

// Why a guest leaves on purpose; the host hears it with the peer-gone.
export type ByeReason = 'no-path';

export type ErrorCode = 'bad-code' | 'burnt' | 'expired' | 'rate-limited' | 'no-host' | 'busy';

export type ServerMessage =
  | { t: 'ready'; code: string; scanKey: string }
  | { t: 'peer'; peerId: string; via: 'code' | 'scan' | 'resume'; needsAllow: boolean; label: string }
  | { t: 'joined'; needsAllow: boolean; resumeToken?: string }
  | { t: 'allowed'; resumeToken: string }
  | { t: 'peer-gone'; peerId: string; reason?: ByeReason }
  | { t: 'pong' }
  | { t: 'denied' }
  | { t: 'sdp'; sdp: Sdp; peerId?: string }
  | { t: 'rotated'; code: string; scanKey: string }
  | { t: 'code'; code: string; state: 'burnt' | 'expired' }
  | { t: 'host-gone' }
  | { t: 'error'; code: ErrorCode };

export interface CreatedRoom {
  roomId: string;
  code: string;
  scanKey: string;
  hostToken: string;
}
