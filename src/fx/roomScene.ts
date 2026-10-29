import { Bloom } from './bloom';
import { LightWall } from './lightWall';
import { mixRgb, rgba, type FxPalette, type Rgb } from './palette';

const MARGIN = 76;
const WALL_TOP = 84;
const FLOOR_FRAC = 0.66;
const REFL_SQUASH = 0.6;
const REFL_SCALE = 0.5;
const REFL_ALPHA = 0.5;
const BLOOM_ALPHA = 0.6;
const LIGHT_SPRITE = 128;
const WARM: Rgb = [255, 130, 140];
const WHITE: Rgb = [255, 255, 255];

export interface RoomCanvases {
  /** Static room, painted on resize only. */
  back: HTMLCanvasElement;
  /** Animated layer, cleared and redrawn every frame. */
  front: HTMLCanvasElement;
}

export interface RoomSceneOptions {
  palette: FxPalette;
  /** Whether decorative motion (room light, glints) is allowed right now. */
  decorative: () => boolean;
}

function lightSprite(c: Rgb): HTMLCanvasElement {
  const s = document.createElement('canvas');
  s.width = s.height = LIGHT_SPRITE;
  const x = s.getContext('2d');
  if (!x) throw new Error('2d canvas unavailable');
  const r = LIGHT_SPRITE / 2;
  const g = x.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, rgba(c, 1));
  g.addColorStop(0.45, rgba(c, 0.3));
  g.addColorStop(1, rgba(c, 0));
  x.fillStyle = g;
  x.fillRect(0, 0, LIGHT_SPRITE, LIGHT_SPRITE);
  return s;
}

/**
 * A wall of light over a polished floor. The room is painted once onto the back canvas; each frame
 * draws the columns, a 1/4 scale glow upscaled additively, and a half-resolution mirror of the wall
 * fading into the floor. Buffers are preallocated; a frame allocates nothing.
 */
export class RoomScene {
  private w = 0;
  private h = 0;
  private dpr = 1;
  private ready = false;
  private floorY = 0;
  private reflH = 0;
  private radius = 0;
  private lightCool: HTMLCanvasElement | null = null;
  private lightWarm: HTMLCanvasElement | null = null;
  private reflFade: CanvasGradient | null = null;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly backCtx: CanvasRenderingContext2D;
  private readonly refl = document.createElement('canvas');
  private readonly reflCtx: CanvasRenderingContext2D;
  private readonly bloom = new Bloom(0.25);
  private readonly wall = new LightWall();

  constructor(private readonly canvases: RoomCanvases, private readonly opts: RoomSceneOptions) {
    const c = canvases.front.getContext('2d');
    const bc = canvases.back.getContext('2d');
    const rc = this.refl.getContext('2d');
    if (!c || !bc || !rc) throw new Error('2d canvas unavailable');
    this.ctx = c;
    this.backCtx = bc;
    this.reflCtx = rc;
  }

  resize(w: number, h: number, dpr: number): void {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    for (const c of [this.canvases.back, this.canvases.front]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    this.rebuild();
  }

  /** Recomputes layout and repaints the static back canvas. */
  private rebuild(): void {
    const { w, h, dpr } = this;
    const p = this.opts.palette;
    this.ready = false;
    if (w < 300 || h < 300) return;
    const floorY = Math.round(h * FLOOR_FRAC);
    this.floorY = floorY;
    this.reflH = h - floorY - 4;

    this.wall.layout(MARGIN, WALL_TOP, floorY, w - 2 * MARGIN, dpr, p);

    const c = this.backCtx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    this.paintRoom(c, p);
    this.wall.paintLabels(c, p);

    this.bloom.resize(w, h);
    this.refl.width = Math.max(1, Math.round(w * dpr * REFL_SCALE));
    this.refl.height = Math.max(1, Math.round(this.reflH * dpr * REFL_SCALE));
    this.reflFade = this.reflCtx.createLinearGradient(0, 0, 0, this.refl.height);
    this.reflFade.addColorStop(0, 'rgba(0,0,0,1)');
    this.reflFade.addColorStop(0.3, 'rgba(0,0,0,0.4)');
    this.reflFade.addColorStop(0.75, 'rgba(0,0,0,0)');

    this.radius = Math.max(w, h) * 0.6;
    this.lightCool ??= lightSprite(p.accentRgb);
    this.lightWarm ??= lightSprite(WARM);
    this.ready = true;
  }

  /** Back wall, glossy floor, receding lines and the horizon sheen. */
  private paintRoom(c: CanvasRenderingContext2D, p: FxPalette): void {
    const { w, h, floorY } = this;
    const a = p.accentRgb;
    const wallG = c.createLinearGradient(0, WALL_TOP - 40, 0, floorY);
    wallG.addColorStop(0, rgba(a, 0));
    wallG.addColorStop(1, rgba(a, 0.05));
    c.fillStyle = wallG;
    c.fillRect(0, 0, w, floorY);

    const floorG = c.createLinearGradient(0, floorY, 0, h);
    floorG.addColorStop(0, rgba(mixRgb(a, WHITE, 0.2), 0.07));
    floorG.addColorStop(0.5, 'rgba(0,0,0,0.25)');
    floorG.addColorStop(1, 'rgba(0,0,0,0.5)');
    c.fillStyle = floorG;
    c.fillRect(0, floorY, w, h - floorY);

    const cx = w / 2;
    const vp = floorY - this.wall.height * 0.35;
    c.save();
    c.beginPath();
    c.rect(0, floorY + 1, w, h - floorY);
    c.clip();
    c.lineWidth = 1;
    const lines = c.createLinearGradient(0, floorY, 0, h);
    lines.addColorStop(0, rgba(a, 0.16));
    lines.addColorStop(1, rgba(a, 0));
    c.strokeStyle = lines;
    c.beginPath();
    for (let i = -16; i <= 16; i++) {
      const x0 = cx + i * (this.wall.width / 30);
      c.moveTo(x0, floorY);
      c.lineTo(cx + ((x0 - cx) * (h - vp)) / (floorY - vp), h);
    }
    let y = floorY;
    let step = 6;
    while (y < h) {
      y += step;
      step *= 1.5;
      c.moveTo(0, y);
      c.lineTo(w, y);
    }
    c.stroke();
    c.restore();

    const sheen = c.createLinearGradient(MARGIN - 40, 0, w - MARGIN + 40, 0);
    sheen.addColorStop(0, rgba(a, 0));
    sheen.addColorStop(0.15, rgba(a, 0.55));
    sheen.addColorStop(0.5, rgba(mixRgb(a, WHITE, 0.5), 0.9));
    sheen.addColorStop(0.85, rgba(a, 0.55));
    sheen.addColorStop(1, rgba(a, 0));
    c.fillStyle = sheen;
    c.fillRect(MARGIN - 40, floorY, this.wall.width + 80, 1);
    c.globalAlpha = 0.25;
    c.fillRect(MARGIN - 40, floorY + 1, this.wall.width + 80, 2);
    c.globalAlpha = 1;
  }

  draw(nowMs: number, dtMs: number, bands: Float32Array): void {
    if (!this.ready) return;
    const { ctx, w, h, dpr } = this;
    const decorative = this.opts.decorative();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    this.wall.step(nowMs, dtMs, bands);
    this.bloom.clear();
    this.wall.draw(ctx, this.bloom, decorative);
    this.bloom.composite(ctx, BLOOM_ALPHA);
    this.drawReflection();
    if (decorative) this.drawRoomLight(this.wall.bass());
  }

  /** An elliptical light sprite centred at (w/2, cy), cut to the rows between y0 and y1. */
  private light(sprite: HTMLCanvasElement | null, cy: number, ry: number, y0: number, y1: number, alpha: number): void {
    if (!sprite || alpha <= 0.002) return;
    const rx = this.radius;
    const top = Math.max(y0, cy - ry);
    const bot = Math.min(y1, cy + ry);
    if (bot <= top) return;
    const k = LIGHT_SPRITE / (2 * ry);
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(sprite, 0, (top - cy + ry) * k, LIGHT_SPRITE, (bot - top) * k, this.w / 2 - rx, top, 2 * rx, bot - top);
  }

  /** Back-wall light that swells and warms with bass, and the share the floor catches. */
  private drawRoomLight(bass: number): void {
    const { floorY, h, radius } = this;
    const cy = floorY - this.wall.height * 0.35;
    const warm = 0.35 * Math.max(0, bass - 0.35);
    const b2 = bass * bass;
    this.ctx.globalCompositeOperation = 'lighter';
    this.light(this.lightCool, cy, radius * 0.6, 0, floorY, 0.12 + 0.6 * b2);
    this.light(this.lightWarm, cy, radius * 0.6, 0, floorY, warm);
    this.light(this.lightCool, floorY, radius * 0.3, floorY, h, 0.06 + 0.3 * b2);
    this.light(this.lightWarm, floorY, radius * 0.3, floorY, h, warm * 0.5);
    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = 'source-over';
  }

  /** Mirrors the wall (columns plus glow) under the floor line at half resolution, fading with depth. */
  private drawReflection(): void {
    if (!this.reflFade) return;
    const rc = this.reflCtx;
    const rw = this.refl.width;
    const rh = this.refl.height;
    const { dpr, floorY } = this;
    const srcH = Math.min(floorY, this.reflH / REFL_SQUASH);
    rc.globalCompositeOperation = 'source-over';
    rc.setTransform(1, 0, 0, -1, 0, rh);
    rc.clearRect(0, 0, rw, rh);
    rc.drawImage(this.canvases.front, 0, (floorY - srcH) * dpr, this.w * dpr, srcH * dpr, 0, 0, rw, rh);
    rc.setTransform(1, 0, 0, 1, 0, 0);
    rc.globalCompositeOperation = 'destination-in';
    rc.fillStyle = this.reflFade;
    rc.fillRect(0, 0, rw, rh);
    const { ctx } = this;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = REFL_ALPHA;
    ctx.drawImage(this.refl, 0, floorY + 3, this.w, this.reflH);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}
