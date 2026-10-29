export type Rgb = readonly [number, number, number];

export interface FxPalette {
  accent: string;
  accentRgb: Rgb;
  text: string;
  faint: string;
  font: string;
}

/** Any CSS colour to RGB, via a 1px canvas read-back. */
export function parseColor(css: string): Rgb {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const x = c.getContext('2d', { willReadFrequently: true });
  if (!x) return [140, 190, 255];
  x.fillStyle = '#000';
  x.fillStyle = css;
  x.fillRect(0, 0, 1, 1);
  const d = x.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function rgba(c: Rgb, a: number): string {
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
}

/** Resolves the colours the scene needs from the app's CSS tokens, as seen from `el`. */
export function resolvePalette(el: Element): FxPalette {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  const accent = v('--accent');
  return { accent, accentRgb: parseColor(accent), text: v('--text'), faint: v('--text-faint'), font: v('--font-mono') };
}
