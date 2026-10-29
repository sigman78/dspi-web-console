import { createCanvas, type ColorSpace } from './canvas';

/** Channels 0..255, encoded in the colour space the scene renders in. */
export type Rgb = readonly [number, number, number];

export interface FxPalette {
  accent: string;
  /** The accent as sRGB, for deriving its hue. */
  accentRgb: Rgb;
  text: string;
  faint: string;
  font: string;
  space: ColorSpace;
}

/** Any CSS colour to sRGB, via a 1px canvas read-back. */
export function parseColor(css: string): Rgb {
  const [, x] = createCanvas(1, 1, 'srgb');
  x.fillStyle = '#000';
  x.fillStyle = css;
  x.fillRect(0, 0, 1, 1);
  const d = x.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** A canvas colour string in `space`, so call sites never care which gamut is active. */
export function css(c: Rgb, alpha: number, space: ColorSpace): string {
  if (space === 'display-p3') {
    return `color(display-p3 ${(c[0] / 255).toFixed(4)} ${(c[1] / 255).toFixed(4)} ${(c[2] / 255).toFixed(4)} / ${alpha})`;
  }
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${alpha})`;
}

// OKLab conversions (Bjorn Ottosson), through linear sRGB.
type Vec3 = [number, number, number];

/** Linear sRGB to linear Display P3, and back. */
const SRGB_TO_P3 = [
  [0.8224621, 0.177538, 0],
  [0.0331941, 0.9668058, 0],
  [0.0170827, 0.0723974, 0.9105199],
];
const P3_TO_SRGB = [
  [1.2249401, -0.2249404, 0],
  [-0.0420569, 1.0420571, 0],
  [-0.0196376, -0.0786361, 1.0982735],
];
const GAMUT_EPS = 1e-6;
const GAMUT_STEPS = 24;

function mul(m: number[][], v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

/** Both sRGB and Display P3 use this transfer curve. */
function encode(x: number): number {
  const v = Math.min(1, Math.max(0, x));
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

function decode(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** OKLab to linear RGB in `space` (unclamped). */
function labToLinear(L: number, a: number, b: number, space: ColorSpace): Vec3 {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const srgb: Vec3 = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return space === 'display-p3' ? mul(SRGB_TO_P3, srgb) : srgb;
}

function inGamut(v: Vec3): boolean {
  return v.every((x) => x >= -GAMUT_EPS && x <= 1 + GAMUT_EPS);
}

/**
 * OKLCH to channels 0..255 in `space`. Out-of-gamut requests lose chroma at the
 * same lightness and hue until they fit; channels are never clipped to fit.
 */
export function oklchToRgb(l: number, c: number, hDeg: number, space: ColorSpace = 'srgb'): Rgb {
  if (l <= 0) return [0, 0, 0];
  if (l >= 1) return [255, 255, 255];
  const h = (hDeg * Math.PI) / 180;
  const at = (chroma: number) => labToLinear(l, chroma * Math.cos(h), chroma * Math.sin(h), space);
  let lin = at(c);
  if (!inGamut(lin)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < GAMUT_STEPS; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(at(mid))) lo = mid;
      else hi = mid;
    }
    lin = at(lo);
  }
  return [encode(lin[0]) * 255, encode(lin[1]) * 255, encode(lin[2]) * 255];
}

/** Channels 0..255 in `space` to [L, C, hue in degrees]. */
export function rgbToOklch(rgb: Rgb, space: ColorSpace = 'srgb'): [number, number, number] {
  const lin: Vec3 = [decode(rgb[0] / 255), decode(rgb[1] / 255), decode(rgb[2] / 255)];
  const [r, g, b] = space === 'display-p3' ? mul(P3_TO_SRGB, lin) : lin;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const hue = (Math.atan2(bb, a) * 180) / Math.PI;
  return [L, Math.hypot(a, bb), (hue + 360) % 360];
}

/** Resolves the colours the scene needs from the app's CSS tokens, as seen from `el`. */
export function resolvePalette(el: Element, space: ColorSpace = 'srgb'): FxPalette {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  const accent = v('--accent');
  return { accent, accentRgb: parseColor(accent), text: v('--text'), faint: v('--text-faint'), font: v('--font-mono'), space };
}
