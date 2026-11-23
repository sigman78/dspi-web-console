import type { DspTransport } from '@/transport/DspTransport';
import { Codec } from '@/utils';
import type { ActionCommand, Command } from './types';

// Read a fixed-size payload via a `Command<T>` descriptor. Control-IN may
// return fewer bytes than requested (short NUL-terminated strings, etc.), so
// `decodePadded` zero-pads to the codec's size before decoding.
export async function readCmd<T>(
  t: DspTransport, c: Command<T> & { readonly legacy: { readonly get: number } }, wValue = 0,
): Promise<T> {
  return Codec.decodePadded(c.codec, await t.ctrlIn(c.legacy.get, wValue, Codec.sizeOf(c.codec)));
}

// Write a fixed-size payload via a `Command<T>` descriptor.
export async function writeCmd<T>(
  t: DspTransport, c: Command<T> & { readonly legacy: { readonly set: number } }, value: T, wValue = 0,
): Promise<void> {
  await t.ctrlOut(c.legacy.set, wValue, Codec.encode(c.codec, value));
}

// Action-style IN: control-IN that the firmware uses to *trigger* a side
// effect and return a 1-byte status code. Returns 0xFF if the response
// is empty (transport-level failure short of a throw). The raw byte is
// decoded into a typed Result by the helpers in results.ts.
export async function actionCmd(t: DspTransport, a: ActionCommand, wValue = 0): Promise<number> {
  const r = await t.ctrlIn(a.legacy.code, wValue, 1);
  return r.length >= 1 ? r[0] : 0xFF;
}

// 1-byte control-IN read of a getter; same 0xFF-on-empty fallback as actionCmd.
export async function readByte(
  t: DspTransport, c: { readonly legacy: { readonly get: number } }, wValue = 0,
): Promise<number> {
  const r = await t.ctrlIn(c.legacy.get, wValue, 1);
  return r.length >= 1 ? r[0] : 0xFF;
}
