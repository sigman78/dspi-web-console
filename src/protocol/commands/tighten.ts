import type { BinCodec } from '@/utils';

// Re-type a wire codec to a narrower API-level shape (ChannelId, FilterType,
// ...) at the type level only; the runtime codec is unchanged. Needed because
// BinCodec<T> is invariant in T, so a direct assignment is rejected.
export function tighten<T>(codec: BinCodec<unknown>): BinCodec<T> {
  return codec as BinCodec<T>;
}
