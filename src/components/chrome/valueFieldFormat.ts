export type ValueKind =
  | 'dB'
  | 'dB-signed'
  | 'ms'
  | 'hz'
  | 'q'
  | 'pct'
  | 'int';

interface FormatterEntry {
  defaultPrecision: number;
  defaultUnit: string;
  format: (v: number, precision: number) => string;
}

// Uses U+2212 (true minus) so the glyph aligns visually with `+` and the
// leading space placeholder.
function signOf(v: number): string {
  if (v > 0) return '+';
  if (v < 0) return '−';
  return ' ';
}

export const formatters: Record<ValueKind, FormatterEntry> = {
  'dB': {
    defaultPrecision: 2,
    defaultUnit: 'dB',
    format: (v, p) => v.toFixed(p),
  },
  'dB-signed': {
    defaultPrecision: 2,
    defaultUnit: 'dB',
    format: (v, p) => signOf(v) + Math.abs(v).toFixed(p),
  },
  'ms': {
    defaultPrecision: 1,
    defaultUnit: 'ms',
    format: (v, p) => v.toFixed(p),
  },
  'hz': {
    defaultPrecision: 0,
    defaultUnit: 'Hz',
    // The `k` shorthand keeps wide-range plots readable.
    format: (v) => {
      if (v >= 10000) return (v / 1000).toFixed(1) + 'k';
      if (v >= 1000) return (v / 1000).toFixed(2) + 'k';
      return Math.round(v).toString();
    },
  },
  'q': {
    defaultPrecision: 2,
    defaultUnit: '',
    format: (v, p) => v.toFixed(p),
  },
  'pct': {
    defaultPrecision: 0,
    defaultUnit: '%',
    format: (v, p) => v.toFixed(p),
  },
  'int': {
    defaultPrecision: 0,
    defaultUnit: '',
    format: (v) => Math.round(v).toString(),
  },
};

export function defaultPrecisionFor(kind: ValueKind): number {
  return formatters[kind].defaultPrecision;
}

export function defaultUnitFor(kind: ValueKind): string {
  return formatters[kind].defaultUnit;
}

export function formatValue(kind: ValueKind, v: number, precision: number): string {
  return formatters[kind].format(v, precision);
}

// Number of decimals implied by a step value. Used to keep snap-to-step
// from producing floats with absurd trailing decimals (0.30000000000000004).
export function stepDecimals(step: number): number {
  if (!step) return 0;
  const s = String(step);
  const i = s.indexOf('.');
  return i < 0 ? 0 : Math.min(6, s.length - i - 1);
}

// Parse, optionally clamp, snap to step. Returns null when the input
// doesn't parse to a finite number, or when `clamp` is false and the
// parsed value falls outside `[min,max]`. Caller distinguishes "valid
// vs invalid" by whether the result is non-null.
export function parseAndClamp(
  raw: string,
  min: number,
  max: number,
  step: number,
  clamp = true,
): number | null {
  // Accept european-style `,` decimal as if it were `.`. Strip any other
  // non-numeric characters so a stray unit suffix doesn't kill the parse.
  const cleaned = raw.replace(',', '.').replace(/[^\d.\-+eE]/g, '');
  const parsed = parseFloat(cleaned);
  if (!Number.isFinite(parsed)) return null;
  let v = parsed;
  if (clamp) {
    if (v < min) v = min;
    if (v > max) v = max;
  } else if (v < min || v > max) {
    return null;
  }
  if (step > 0) {
    v = Math.round(v / step) * step;
    v = +v.toFixed(stepDecimals(step));
  }
  return v;
}
