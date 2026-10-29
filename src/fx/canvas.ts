export type ColorSpace = 'srgb' | 'display-p3';

/** Display P3 when the screen and the canvas implementation both support it, else sRGB. */
export function detectColorSpace(): ColorSpace {
  try {
    if (typeof matchMedia !== 'function' || !matchMedia('(color-gamut: p3)').matches) return 'srgb';
    const probe = document.createElement('canvas').getContext('2d', { colorSpace: 'display-p3' });
    return probe?.getContextAttributes?.().colorSpace === 'display-p3' ? 'display-p3' : 'srgb';
  } catch {
    return 'srgb';
  }
}

/** A context's colour space is fixed by its first getContext call, so every canvas goes through here. */
export function context2d(c: HTMLCanvasElement, space: ColorSpace, willReadFrequently = false): CanvasRenderingContext2D {
  const x = c.getContext('2d', { colorSpace: space, willReadFrequently });
  if (!x) throw new Error('2d canvas unavailable');
  return x;
}

export function createCanvas(w: number, h: number, space: ColorSpace): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return [c, context2d(c, space)];
}
