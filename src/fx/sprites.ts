import { createCanvas, type ColorSpace } from './canvas';
import { css, type Rgb } from './palette';

/** A soft radial glow sprite of `size` css px, rendered at `dpr` scale. */
export function blob(size: number, dpr: number, color: Rgb, alpha: number, space: ColorSpace): HTMLCanvasElement {
  const [c, x] = createCanvas(size * dpr, size * dpr, space);
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  const r = size / 2;
  const g = x.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, css(color, alpha, space));
  g.addColorStop(0.3, css(color, alpha * 0.4, space));
  g.addColorStop(1, css(color, 0, space));
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  return c;
}

