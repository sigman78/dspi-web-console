import type { BinCodec } from '@/utils';

// One side of a logical command is the vendor-control opcode (`bRequest`) it
// uses on legacy firmware; a side is absent when the command has no such
// direction.
export interface LegacySide { readonly get?: number; readonly set?: number }

// The paged-protocol (fw 1.1.7+) command ids of a logical command; absent
// until the command has a paged form the console uses.
export interface PagedSide { readonly get?: number; readonly set?: number }

// Fixed-size payload; readCmd/writeCmd encode and decode it.
export interface Command<T> { readonly codec: BinCodec<T>; readonly legacy: LegacySide; readonly paged?: PagedSide }

// Variable-length or wValue-multiplexed payload, parsed by the caller.
export interface RawCommand { readonly legacy: LegacySide; readonly paged?: PagedSide }

// Control-IN that triggers a side effect and answers a 1-byte status.
export interface ActionCommand { readonly legacy: { readonly code: number } }
