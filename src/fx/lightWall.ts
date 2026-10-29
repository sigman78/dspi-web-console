import { BAND_COUNT, BAND_TICKS } from './bands';
import { SPECTRUM_BALLISTICS, newMeter, stepMeter } from './ballistics';
import { createCanvas, type ColorSpace } from './canvas';
import { css, oklchToRgb, type FxPalette, type Rgb } from './palette';
import type { Bloom } from './bloom';

const BAR_W = 0.56;
const STEPS = 24;
const TIP = 2;
const HALO_W = 4;
const HALO_SIGMA = 0.16;
const HALO_ALPHA = 0.42;
const HALO_BLOB_ALPHA = 0.5;
/** The glow buffer is quarter scale, so its sprites are pre-rendered at that resolution. */
const GLOW_RES = 0.25;

// The bar ramp in OKLCH: hue drifts up from the scene hue, lightness and chroma climb gently.
const HUE_SPAN = 150;
const L_BOTTOM = 0.7;
const L_TOP = 0.84;
const C_BOTTOM = 0.13;
const C_TOP = 0.16;
/** Extra lightness at the very bottom, fading out over the lowest quarter. */
const FOOT_LIFT = 0.03;
const FOOT_RANGE = 0.25;
/** Lighter variants move toward L=1 by `lift` and shed this share of chroma at full lift. */
const LIFT_DESAT = 0.8;

// Lifts toward white: how hot each part of a bar reads.
const CORE_LIFT = 0.22;
const HALO_RAMP_LIFT = 0.06;
const TIP_LIFT = 0.3;
const HALO_BLOB_LIFT = 0.12;
const MARKER_LIFT = 0.4;

/** Colour at a height fraction `f` for scene hue `hue`, optionally lifted toward white. */
export function barColor(f: number, hue: number, space: ColorSpace, lift = 0): Rgb {
  const t = Math.min(1, Math.max(0, f));
  const foot = t < FOOT_RANGE ? FOOT_LIFT * (1 - t / FOOT_RANGE) : 0;
  const l = L_BOTTOM + (L_TOP - L_BOTTOM) * t + foot;
  const c = C_BOTTOM + (C_TOP - C_BOTTOM) * t;
  return oklchToRgb(l + (1 - l) * lift, c * (1 - lift * LIFT_DESAT), hue + HUE_SPAN * t, space);
}

/** Vertical colour ramp over a full-height rect, lifted toward white by `lift`. */
function ramp(x: CanvasRenderingContext2D, h: number, hue: number, space: ColorSpace, lift: number, aBottom: number, aTop: number): CanvasGradient {
  const v = x.createLinearGradient(0, h, 0, 0);
  for (let k = 0; k <= 8; k++) {
    const f = k / 8;
    v.addColorStop(f, css(barColor(f, hue, space, lift), aBottom + (aTop - aBottom) * f, space));
  }
  return v;
}

/** A ramp under a gaussian horizontal falloff: the soft halo a bar casts. */
function haloStrip(w: number, h: number, res: number, hue: number, space: ColorSpace): HTMLCanvasElement {
  const [c, x] = createCanvas(w * res, h * res, space);
  x.setTransform(res, 0, 0, res, 0, 0);
  x.fillStyle = ramp(x, h, hue, space, HALO_RAMP_LIFT, 0.7, 1);
  x.fillRect(0, 0, w, h);
  const g = x.createLinearGradient(0, 0, w, 0);
  for (let k = 0; k <= 12; k++) {
    const t = k / 12;
    g.addColorStop(t, `rgba(0,0,0,${Math.exp(-(((t - 0.5) / HALO_SIGMA) ** 2))})`);
  }
  x.globalCompositeOperation = 'destination-in';
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  return c;
}

function blob(size: number, dpr: number, color: Rgb, alpha: number, space: ColorSpace): HTMLCanvasElement {
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

/**
 * Third-octave bars standing on a floor line: hard-edged on the canvas, soft only in the glow buffer.
 * Bars, tips and halos are pre-rendered at layout, so a frame only blits.
 */
export class LightWall {
  x = 0;
  floorY = 0;
  width = 0;
  height = 0;
  private stride = 0;
  private barW = 0;
  private haloSize = 0;
  private dpr = 1;
  private body: HTMLCanvasElement | null = null;
  private halo: HTMLCanvasElement | null = null;
  private tips: HTMLCanvasElement[] = [];
  private halos: HTMLCanvasElement[] = [];
  private marker: HTMLCanvasElement | null = null;
  private readonly state = Array.from({ length: BAND_COUNT }, newMeter);

  layout(x: number, top: number, floorY: number, width: number, dpr: number, p: FxPalette, hue: number): void {
    this.x = x;
    this.floorY = floorY;
    this.width = width;
    this.height = floorY - top;
    this.dpr = dpr;
    this.stride = width / BAND_COUNT;
    this.barW = Math.max(2, Math.round(this.stride * BAR_W * dpr)) / dpr;
    this.haloSize = this.stride * 2.4;
    const H = this.height;
    const bw = this.barW;
    const sp = p.space;

    // A solid bar with a brighter centre stripe: both edges stay hard.
    const [body, bc] = createCanvas(bw * dpr, H * dpr, sp);
    bc.setTransform(dpr, 0, 0, dpr, 0, 0);
    bc.fillStyle = ramp(bc, H, hue, sp, 0, 0.62, 0.9);
    bc.fillRect(0, 0, bw, H);
    bc.globalCompositeOperation = 'lighter';
    bc.fillStyle = ramp(bc, H, hue, sp, CORE_LIFT, 0.12, 0.28);
    const core = Math.max(1 / dpr, Math.round(bw * 0.34 * dpr) / dpr);
    bc.fillRect((bw - core) / 2, 0, core, H);
    this.body = body;
    this.halo = haloStrip(bw * HALO_W, H, GLOW_RES, hue, sp);

    this.tips = Array.from({ length: STEPS }, (_, k) => {
      const [c, x] = createCanvas(bw * dpr, TIP * dpr, sp);
      x.fillStyle = css(barColor(k / (STEPS - 1), hue, sp, TIP_LIFT), 1, sp);
      x.fillRect(0, 0, c.width, c.height);
      return c;
    });
    this.halos = Array.from({ length: STEPS }, (_, k) =>
      blob(this.haloSize, GLOW_RES, barColor(k / (STEPS - 1), hue, sp, HALO_BLOB_LIFT), HALO_BLOB_ALPHA, sp));
    const [m, mx] = createCanvas(bw * dpr, TIP * dpr, sp);
    mx.fillStyle = css(barColor(1, hue, sp, MARKER_LIFT), 1, sp);
    mx.fillRect(0, 0, m.width, m.height);
    this.marker = m;
  }

  private cx(i: number): number {
    return this.x + (i + 0.5) * this.stride;
  }

  /** Left edge of bar `i`, snapped to a device pixel. */
  private left(i: number): number {
    return Math.round((this.cx(i) - this.barW / 2) * this.dpr) / this.dpr;
  }

  /** Sparse frequency labels under the floor line. */
  paintLabels(c: CanvasRenderingContext2D, p: FxPalette): void {
    c.font = `10px ${p.font}`;
    c.textAlign = 'center';
    c.fillStyle = p.faint;
    c.globalAlpha = 0.7;
    for (const [i, label] of BAND_TICKS) c.fillText(label, this.cx(i), this.floorY + 15);
    c.globalAlpha = 1;
  }

  step(nowMs: number, dtMs: number, bands: Float32Array): void {
    for (let i = 0; i < BAND_COUNT; i++) stepMeter(this.state[i], bands[i], nowMs, dtMs, SPECTRUM_BALLISTICS);
  }

  /** Smoothed low-band energy, 0..1. */
  bass(): number {
    let s = 0;
    for (let i = 0; i < 6; i++) s += this.state[i].level;
    return s / 6;
  }

  /** Crisp bars, tips and (optionally) peak markers on the canvas; their wide halos into the glow buffer. */
  draw(ctx: CanvasRenderingContext2D, bloom: Bloom, markers: boolean): void {
    const { body, halo, marker, dpr } = this;
    if (!body || !halo || !marker) return;
    const b = bloom.ctx;
    const H = this.height;
    const bw = this.barW;
    const hw = bw * HALO_W;
    const hs = this.haloSize;
    ctx.globalCompositeOperation = 'lighter';
    b.globalCompositeOperation = 'lighter';
    for (let i = 0; i < BAND_COUNT; i++) {
      const l = Math.min(1, this.state[i].level);
      const hh = Math.round(l * H * dpr) / dpr;
      if (hh < TIP) continue;
      const x0 = this.left(i);
      const top = this.floorY - hh;
      const sy = (H - hh) * dpr;
      const k = Math.round(l * (STEPS - 1));
      ctx.drawImage(body, 0, sy, body.width, body.height - sy, x0, top, bw, hh);
      ctx.drawImage(this.tips[k], x0, top, bw, TIP);
      b.globalAlpha = HALO_ALPHA;
      const gy = (H - hh) * GLOW_RES;
      b.drawImage(halo, 0, gy, halo.width, halo.height - gy, this.cx(i) - hw / 2, top, hw, hh);
      b.globalAlpha = 1;
      b.drawImage(this.halos[k], this.cx(i) - hs / 2, top - hs / 2, hs, hs);
    }
    if (markers) {
      for (let i = 0; i < BAND_COUNT; i++) {
        const s = this.state[i];
        const gap = s.peak - s.level;
        if (gap < 0.03) continue;
        ctx.globalAlpha = Math.min(1, gap * 8) * 0.45;
        ctx.drawImage(marker, this.left(i), Math.round((this.floorY - s.peak * H) * dpr) / dpr, bw, TIP);
      }
    }
    ctx.globalAlpha = 1;
    b.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    b.globalCompositeOperation = 'source-over';
  }
}
