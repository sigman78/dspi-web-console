import { createCanvas, type ColorSpace } from './canvas';

/** Low-resolution glow buffer: callers draw in full-size coordinates, compositing upscales it softly. */
export class Bloom {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;

  constructor(private readonly scale: number, space: ColorSpace) {
    [this.canvas, this.ctx] = createCanvas(1, 1, space);
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.canvas.width = Math.max(1, Math.ceil(w * this.scale));
    this.canvas.height = Math.max(1, Math.ceil(h * this.scale));
    this.ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.w, this.h);
  }

  /** Additively blends the buffer over `dst` (already scaled to full-size coordinates). */
  composite(dst: CanvasRenderingContext2D, alpha: number): void {
    dst.globalCompositeOperation = 'lighter';
    dst.globalAlpha = alpha;
    dst.imageSmoothingEnabled = true;
    dst.drawImage(this.canvas, 0, 0, this.w, this.h);
    dst.globalAlpha = 1;
    dst.globalCompositeOperation = 'source-over';
  }
}
