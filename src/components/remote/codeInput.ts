import { CODE_ALPHABET, CODE_LENGTH } from '@/runtime/remote/relayWire';

const inAlphabet = (c: string): boolean => CODE_ALPHABET.includes(c);

// Three plus three alphabet symbols standing alone in the text, dash or space between optional.
const RUN = new RegExp(`(?<![A-Z0-9])([${CODE_ALPHABET}]{3})[-\\s]?([${CODE_ALPHABET}]{3})(?![A-Z0-9])`);

/** The code-alphabet characters of typed text, at most one code's worth. */
export function codeChars(text: string): string {
  return [...text.toUpperCase()].filter(inAlphabet).join('').slice(0, CODE_LENGTH);
}

/**
 * A whole code out of pasted text: the `join` parameter of a link, the text
 * itself when it is just a code, or a code standing inside a sentence. A single
 * symbol passes so a paste into one cell behaves like typing. Empty otherwise.
 */
export function pastedCode(text: string): string {
  let raw = text;
  const link = /[?&#]join=([^&#s]*)/i.exec(text);
  if (link) {
    try {
      raw = decodeURIComponent(link[1]);
    } catch {
      raw = link[1];
    }
  }
  const up = raw.toUpperCase();
  const bare = up.replace(/[s-]/g, '');
  if (bare.length === CODE_LENGTH && [...bare].every(inAlphabet)) return bare;
  const run = RUN.exec(up);
  if (run) return run[1] + run[2];
  return bare.length === 1 && inAlphabet(bare) ? bare : '';
}

/** `ABCDEF` as `ABC-DEF`. */
export function formatCode(code: string): string {
  const half = CODE_LENGTH / 2;
  return code.length > half ? `${code.slice(0, half)}-${code.slice(half)}` : code;
}
