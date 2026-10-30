// Tunnel frame codec: 5-byte header (u8 type, u32 correlation id) then a
// type-specific little-endian body.

import { BinReader, BinWriter, utf8Truncate } from '@/utils';

export const TUNNEL_VERSION = 1;
// Control-transfer payload cap (WinUSB limit).
export const MAX_PAYLOAD = 4096;
// Anything larger than this on the wire is a protocol violation.
export const MAX_FRAME_BYTES = 8192;

const HEADER_BYTES = 5;
const MAX_TEXT_BYTES = 255;

export const FrameType = {
  Hello: 0x01,
  Welcome: 0x02,
  Reject: 0x03,
  CtrlIn: 0x10,
  CtrlOut: 0x11,
  NotifyIn: 0x12,
  Ok: 0x20,
  Err: 0x21,
  Event: 0x30,
} as const;

export const RejectReason = { Version: 1, Busy: 2, Denied: 3 } as const;
export const LeaseKind = { Full: 0, ReadOnly: 1 } as const;
export const DeviceEvent = { Connect: 1, Disconnect: 2, Release: 3 } as const;
export const ErrKind = {
  Transport: 1,
  Timeout: 2,
  Refused: 4,
  NotOpen: 5,
} as const;

export type Frame =
  | { type: 'hello'; version: number; wantReadOnly: boolean; consoleBuild: string }
  | { type: 'welcome'; version: number; leaseKind: number; hasNotify: boolean; consoleBuild: string }
  | { type: 'reject'; reason: number }
  | { type: 'ctrlIn'; id: number; request: number; value: number; length: number }
  | { type: 'ctrlOut'; id: number; request: number; value: number; data: Uint8Array }
  | { type: 'notifyIn'; id: number; length: number }
  | { type: 'ok'; id: number; data: Uint8Array }
  | { type: 'err'; id: number; kind: number; message: string }
  | { type: 'event'; event: number };

const TEXT = new TextEncoder();

function textBytes(s: string): Uint8Array {
  return TEXT.encode(utf8Truncate(s, MAX_TEXT_BYTES));
}

function begin(type: number, id: number, bodyBytes: number): BinWriter {
  return new BinWriter(HEADER_BYTES + bodyBytes).u8(type).u32(id);
}

export function encodeFrame(f: Frame): Uint8Array {
  switch (f.type) {
    case 'hello': {
      const text = textBytes(f.consoleBuild);
      return begin(FrameType.Hello, 0, 3 + text.length)
        .u8(f.version).bool8(f.wantReadOnly).u8(text.length).bytes(text).toUint8Array();
    }
    case 'welcome': {
      const text = textBytes(f.consoleBuild);
      return begin(FrameType.Welcome, 0, 4 + text.length)
        .u8(f.version).u8(f.leaseKind).bool8(f.hasNotify).u8(text.length).bytes(text).toUint8Array();
    }
    case 'reject':
      return begin(FrameType.Reject, 0, 1).u8(f.reason).toUint8Array();
    case 'ctrlIn':
      return begin(FrameType.CtrlIn, f.id, 5).u8(f.request).u16(f.value).u16(f.length).toUint8Array();
    case 'ctrlOut':
      return begin(FrameType.CtrlOut, f.id, 5 + f.data.length)
        .u8(f.request).u16(f.value).u16(f.data.length).bytes(f.data).toUint8Array();
    case 'notifyIn':
      return begin(FrameType.NotifyIn, f.id, 2).u16(f.length).toUint8Array();
    case 'ok':
      return begin(FrameType.Ok, f.id, f.data.length).bytes(f.data).toUint8Array();
    case 'err': {
      const text = textBytes(f.message);
      return begin(FrameType.Err, f.id, 2 + text.length)
        .u8(f.kind).u8(text.length).bytes(text).toUint8Array();
    }
    case 'event':
      return begin(FrameType.Event, 0, 1).u8(f.event).toUint8Array();
  }
}

// Fixed-size bodies must end exactly where the reader does.
function exact<T>(r: BinReader, frame: T): T {
  if (r.remaining !== 0) throw new RangeError(`${r.remaining} trailing bytes`);
  return frame;
}

// Throws on a malformed frame: truncated, unknown type, oversize, trailing
// bytes, or a length field that disagrees with the bytes present.
export function decodeFrame(buf: Uint8Array): Frame {
  if (buf.byteLength > MAX_FRAME_BYTES) {
    throw new RangeError(`frame too large: ${buf.byteLength}`);
  }
  const r = new BinReader(buf);
  const type = r.u8();
  const id = r.u32();
  switch (type) {
    case FrameType.Hello: {
      const version = r.u8();
      const wantReadOnly = r.bool8();
      return exact(r, { type: 'hello', version, wantReadOnly, consoleBuild: r.utf8Fixed(r.u8()) });
    }
    case FrameType.Welcome: {
      const version = r.u8();
      const leaseKind = r.u8();
      const hasNotify = r.bool8();
      return exact(r, { type: 'welcome', version, leaseKind, hasNotify, consoleBuild: r.utf8Fixed(r.u8()) });
    }
    case FrameType.Reject:
      return exact(r, { type: 'reject', reason: r.u8() });
    case FrameType.CtrlIn:
      return exact(r, { type: 'ctrlIn', id, request: r.u8(), value: r.u16(), length: r.u16() });
    case FrameType.CtrlOut: {
      const request = r.u8();
      const value = r.u16();
      const len = r.u16();
      if (len !== r.remaining) throw new RangeError(`ctrlOut length ${len} != body ${r.remaining}`);
      return { type: 'ctrlOut', id, request, value, data: r.bytes(len).slice() };
    }
    case FrameType.NotifyIn:
      return exact(r, { type: 'notifyIn', id, length: r.u16() });
    case FrameType.Ok:
      return { type: 'ok', id, data: r.bytes(r.remaining).slice() };
    case FrameType.Err: {
      const kind = r.u8();
      return exact(r, { type: 'err', id, kind, message: r.utf8Fixed(r.u8()) });
    }
    case FrameType.Event:
      return exact(r, { type: 'event', event: r.u8() });
    default:
      throw new RangeError(`unknown frame type 0x${type.toString(16)}`);
  }
}
