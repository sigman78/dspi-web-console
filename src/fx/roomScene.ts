import { Bloom } from './bloom';
import { context2d, createCanvas, detectColorSpace, type ColorSpace } from './canvas';
import { LightWall, barColor } from './lightWall';
import { MeterWall, type MeterChannel } from './meterWall';
import { css, oklchToRgb, rgbToOklch, type FxPalette, type Rgb } from './palette';
import type { Wall } from './wall';

const MARGIN = 76;
const WALL_TOP = 84;
const FLOOR_FRAC = 0.66;
const REFL_SQUASH = 0.6;
const REFL_SCALE = 0.5;
const REFL_ALPHA = 0.5;
const BLOOM_ALPHA = 0.42;
const LIGHT_SPRITE = 128;
const FADE_MS = 300;

export type WallMode = 'spectrum' | 'meters';

// Room tint, floor lines and the cool light share one lightness and chroma; only the hue is chosen.
const TINT_L = 0.72;
const TINT_C = 0.13;
const SHEEN_L = 0.8;
const SHEEN_C = 0.1;
const SHEEN_ALPHA = 0.65;

// Room light gains: a resting level plus a bass-driven swell, wall then floor.
const WALL_COOL_BASE = 0.08;
const WALL_COOL_GAIN = 0.42;
const FLOOR_COOL_BASE = 0.04;
const FLOOR_COOL_GAIN = 0.21;
const WARM_GAIN = 0.25;

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
  /** Scene hue in degrees; null or absent follows the accent's own hue. */
  hue?: number | null;
  /** Forces a colour space; absent picks Display P3 when the display and canvas support it. */
  colorSpace?: ColorSpace;
  /** Wall shown first; defaults to the spectrum. */
  mode?: WallMode;
}

function lightSprite(c: Rgb, space: ColorSpace): HTMLCanvasElement {
  const [s, x] = createCanvas(LIGHT_SPRITE, LIGHT_SPRITE, space);
  const r = LIGHT_SPRITE / 2;
  const g = x.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, css(c, 1, space));
  g.addColorStop(0.45, css(c, 0.3, space));
  g.addColorStop(1, css(c, 0, space));
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
  private hue: number;
  private dirty = false;
  /** Which wall's labels the back canvas currently shows. */
  private labelMode: WallMode;
  /** The spectrum was not rebuilt for the latest hue because it was off screen. */
  private spectrumStale = false;
  /** Hue of the accent itself: what a null hue follows. */
  readonly defaultHue: number;
  private readonly space: ColorSpace;
  private readonly palette: FxPalette;
  private floorY = 0;
  private reflH = 0;
  private radius = 0;
  private lightCool: HTMLCanvasElement | null = null;
  private lightWarm: HTMLCanvasElement | null = null;
  private reflFade: CanvasGradient | null = null;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly backCtx: CanvasRenderingContext2D;
  private readonly refl: HTMLCanvasElement;
  private readonly reflCtx: CanvasRenderingContext2D;
  private readonly bloom: Bloom;
  private mode: WallMode;
  private fading: WallMode | null = null;
  private fadeStart = 0;
  readonly spectrum = new LightWall();
  readonly meters = new MeterWall();

  constructor(private readonly canvases: RoomCanvases, private readonly opts: RoomSceneOptions) {
    const space = opts.colorSpace ?? detectColorSpace();
    this.space = space;
    this.palette = { ...opts.palette, space };
    this.defaultHue = rgbToOklch(opts.palette.accentRgb)[2];
    this.hue = opts.hue ?? this.defaultHue;
    this.mode = opts.mode ?? 'spectrum';
    this.labelMode = this.mode;
    this.ctx = context2d(canvases.front, space);
    this.backCtx = context2d(canvases.back, space);
    [this.refl, this.reflCtx] = createCanvas(1, 1, space);
    this.bloom = new Bloom(0.25, space);
  }

  /** Changes the scene hue; any number of calls before the next frame cost one hue pass. */
  setHue(deg: number): void {
    if (!Number.isFinite(deg)) return;
    deg = ((deg % 360) + 360) % 360;
    if (deg === this.hue) return;
    this.hue = deg;
    this.dirty = true;
  }

  /** Switches the wall: a short crossfade, or a hard cut when decorative motion is off. */
  setMode(mode: WallMode, nowMs: number): void {
    if (mode === this.mode) return;
    const out = this.mode;
    if (!this.opts.decorative()) {
      this.fading = null;
    } else if (this.fading !== null) {
      // Switching back mid-fade reverses it from where it stands.
      const t = Math.min(1, Math.max(0, (nowMs - this.fadeStart) / FADE_MS));
      this.fadeStart = nowMs - (1 - t) * FADE_MS;
      this.fading = out;
    } else {
      this.fading = out;
      this.fadeStart = nowMs;
    }
    this.mode = mode;
    if (mode === 'meters') this.meters.reset();
    if (mode === 'spectrum' && this.spectrumStale) this.layoutSpectrum();
  }

  /** Swaps the metered channels; lays the pillars out again and repaints their labels if shown. */
  setMeterChannels(chs: readonly MeterChannel[]): void {
    if (!this.meters.setChannels(chs) || !this.ready) return;
    this.layoutMeters();
    if (this.labelMode === 'meters') this.repaintBack();
  }

  private wallOf(mode: WallMode): Wall {
    return mode === 'spectrum' ? this.spectrum : this.meters;
  }

  private layoutSpectrum(): void {
    this.spectrumStale = false;
    this.spectrum.hue = this.hue;
    this.spectrum.layout(MARGIN, WALL_TOP, this.floorY, this.w - 2 * MARGIN, this.dpr, this.palette);
  }

  private layoutMeters(): void {
    this.meters.layout(MARGIN, WALL_TOP, this.floorY, this.w - 2 * MARGIN, this.dpr, this.palette);
  }

  private repaintBack(): void {
    if (!this.ready) return;
    const c = this.backCtx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    this.paintRoom(c);
    this.wallOf(this.labelMode).paintLabels(c, this.palette);
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
    this.dirty = false;
    this.ready = false;
    if (w < 300 || h < 300) return;
    const floorY = Math.round(h * FLOOR_FRAC);
    this.floorY = floorY;
    this.reflH = h - floorY - 4;

    this.layoutSpectrum();
    this.layoutMeters();

    this.bloom.resize(w, h);
    this.refl.width = Math.max(1, Math.round(w * dpr * REFL_SCALE));
    this.refl.height = Math.max(1, Math.round(this.reflH * dpr * REFL_SCALE));
    this.reflFade = this.reflCtx.createLinearGradient(0, 0, 0, this.refl.height);
    this.reflFade.addColorStop(0, 'rgba(0,0,0,1)');
    this.reflFade.addColorStop(0.3, 'rgba(0,0,0,0.4)');
    this.reflFade.addColorStop(0.75, 'rgba(0,0,0,0)');

    this.radius = Math.max(w, h) * 0.6;
    this.buildLights();
    this.ready = true;
    this.repaintBack();
  }

  private buildLights(): void {
    this.lightCool = lightSprite(oklchToRgb(TINT_L, TINT_C, this.hue, this.space), this.space);
    this.lightWarm = lightSprite(barColor(1, this.hue, this.space), this.space);
  }

  /** The hue changed: only what is built on it is redone; the pillars keep their channel colours. */
  private applyHue(): void {
    if (this.mode === 'spectrum' || this.fading === 'spectrum') this.layoutSpectrum();
    else this.spectrumStale = true;
    this.buildLights();
    this.repaintBack();
  }

  /** Back wall, glossy floor, receding lines and the horizon sheen. */
  private paintRoom(c: CanvasRenderingContext2D): void {
    const { w, h, floorY } = this;
    const sp = this.space;
    const a = oklchToRgb(TINT_L, TINT_C, this.hue, sp);
    const sheenC = oklchToRgb(SHEEN_L, SHEEN_C, this.hue, sp);
    const wallG = c.createLinearGradient(0, WALL_TOP - 40, 0, floorY);
    wallG.addColorStop(0, css(a, 0, sp));
    wallG.addColorStop(1, css(a, 0.05, sp));
    c.fillStyle = wallG;
    c.fillRect(0, 0, w, floorY);

    const floorG = c.createLinearGradient(0, floorY, 0, h);
    floorG.addColorStop(0, css(sheenC, 0.07, sp));
    floorG.addColorStop(0.5, 'rgba(0,0,0,0.25)');
    floorG.addColorStop(1, 'rgba(0,0,0,0.5)');
    c.fillStyle = floorG;
    c.fillRect(0, floorY, w, h - floorY);

    const cx = w / 2;
    const vp = floorY - this.spectrum.height * 0.35;
    c.save();
    c.beginPath();
    c.rect(0, floorY + 1, w, h - floorY);
    c.clip();
    c.lineWidth = 1;
    const lines = c.createLinearGradient(0, floorY, 0, h);
    lines.addColorStop(0, css(a, 0.16, sp));
    lines.addColorStop(1, css(a, 0, sp));
    c.strokeStyle = lines;
    c.beginPath();
    for (let i = -16; i <= 16; i++) {
      const x0 = cx + i * (this.spectrum.width / 30);
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
    sheen.addColorStop(0, css(a, 0, sp));
    sheen.addColorStop(0.15, css(a, 0.55, sp));
    sheen.addColorStop(0.5, css(sheenC, SHEEN_ALPHA, sp));
    sheen.addColorStop(0.85, css(a, 0.55, sp));
    sheen.addColorStop(1, css(a, 0, sp));
    c.fillStyle = sheen;
    c.fillRect(MARGIN - 40, floorY, this.spectrum.width + 80, 1);
    c.globalAlpha = 0.25;
    c.fillRect(MARGIN - 40, floorY + 1, this.spectrum.width + 80, 2);
    c.globalAlpha = 1;
  }

  /** Draws the active wall and, mid-crossfade, the one leaving. The caller steps the active wall. */
  draw(nowMs: number): void {
    if (this.dirty) {
      this.dirty = false;
      if (this.ready) this.applyHue();
    }
    if (!this.ready) return;
    const { ctx, w, h, dpr } = this;
    const decorative = this.opts.decorative();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const wall = this.wallOf(this.mode);
    let t = 1;
    if (this.fading !== null) {
      t = (nowMs - this.fadeStart) / FADE_MS;
      if (t >= 1 || t < 0) {
        t = 1;
        this.fading = null;
      }
    }
    const labels = this.fading !== null && t < 0.5 ? this.fading : this.mode;
    if (labels !== this.labelMode) {
      this.labelMode = labels;
      this.repaintBack();
    }
    this.bloom.clear();
    let energy = wall.energy();
    if (this.fading !== null) {
      const out = this.wallOf(this.fading);
      out.draw(ctx, this.bloom, decorative, 1 - t);
      energy = energy * t + out.energy() * (1 - t);
    }
    wall.draw(ctx, this.bloom, decorative, t);
    this.bloom.composite(ctx, BLOOM_ALPHA);
    this.drawReflection();
    if (decorative) this.drawRoomLight(energy);
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

  /** Back-wall light that swells and warms with the wall's energy, and the share the floor catches. */
  private drawRoomLight(energy: number): void {
    const { floorY, h, radius } = this;
    const cy = floorY - this.spectrum.height * 0.35;
    const warm = WARM_GAIN * Math.max(0, energy - 0.35);
    const b2 = energy * energy;
    this.ctx.globalCompositeOperation = 'lighter';
    this.light(this.lightCool, cy, radius * 0.6, 0, floorY, WALL_COOL_BASE + WALL_COOL_GAIN * b2);
    this.light(this.lightWarm, cy, radius * 0.6, 0, floorY, warm);
    this.light(this.lightCool, floorY, radius * 0.3, floorY, h, FLOOR_COOL_BASE + FLOOR_COOL_GAIN * b2);
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
