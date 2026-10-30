import { describe, it, expect } from 'vitest';
import { codeChars, pastedCode } from './codeInput';

describe('codeChars', () => {
  it('keeps only code-alphabet symbols, uppercased, at most six', () => {
    // 0, 1, I, L, O and U are not in the alphabet.
    expect(codeChars('0A1b-ILOU-C!D@E#F$G')).toBe('ABCDEF');
  });
});

describe('pastedCode', () => {
  it('accepts a bare code with a dash, spaces or lowercase', () => {
    expect(pastedCode(' abc-d3f ')).toBe('ABCD3F');
    expect(pastedCode('abc d3f')).toBe('ABCD3F');
  });

  it('finds the code inside a sentence instead of gluing every letter together', () => {
    expect(pastedCode('Code: ABC-D3F')).toBe('ABCD3F');
    expect(pastedCode('my code is abc-d3f, thanks')).toBe('ABCD3F');
  });

  it('takes the join parameter of an invite link and ignores the rest of the URL', () => {
    expect(pastedCode('https://dspi.example/app/?join=abc-d3f&k=zzzzzzzz')).toBe('ABCD3F');
    expect(pastedCode('https://dspi.example/?k=hello&join=ABCD3F')).toBe('ABCD3F');
  });

  it('rejects text that is not a code, and lets a single symbol through for cell pastes', () => {
    expect(pastedCode('0A1B-ILOU-C!D@E#F$G')).toBe('');
    expect(pastedCode('https://dspi.example/')).toBe('');
    expect(pastedCode('a')).toBe('A');
  });
});
