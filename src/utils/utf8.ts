// UTF-8 helpers. Bare metric + codepoint-aware truncation; the underlying
// BinWriter does raw byte truncation, which can split a multi-byte
// sequence mid-character. Call `utf8Truncate` upstream of the codec when
// silent cropping is desired.

const ENCODER = new TextEncoder();

// Bytes a UTF-8 string would occupy on the wire.
export function utf8ByteLength(s: string): number {
  return ENCODER.encode(s).length;
}

// Truncate `s` to fit within `maxBytes` UTF-8 bytes without splitting a
// codepoint. Iterates by codepoint (Array.from handles surrogate pairs)
// and accumulates byte cost until the next codepoint would overflow.
export function utf8Truncate(s: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  if (utf8ByteLength(s) <= maxBytes) return s;
  let acc = 0;
  let out = '';
  for (const ch of s) {
    const cost = utf8ByteLength(ch);
    if (acc + cost > maxBytes) break;
    acc += cost;
    out += ch;
  }
  return out;
}
