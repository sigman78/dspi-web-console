// Codepoint-aware UTF-8 truncation. BinWriter truncates by raw bytes, which can
// split a multi-byte sequence; call `utf8Truncate` upstream of the codec when
// silent cropping is desired.

const ENCODER = new TextEncoder();

// Bytes a UTF-8 string would occupy on the wire.
export function utf8ByteLength(s: string): number {
  return ENCODER.encode(s).length;
}

// Truncate `s` to fit within `maxBytes` UTF-8 bytes without splitting a
// codepoint (iterating by codepoint handles surrogate pairs).
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
