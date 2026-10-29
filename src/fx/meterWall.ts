import { newMeter, stepMeter } from './ballistics';
import type { Bloom } from './bloom';
import { createCanvas, type ColorSpace } from './canvas';
import { layoutMeters } from './meterLayout';
import { CLIP_DB_FRACTION, VU_BALLISTICS, VU_PEAK_BALLISTICS, VU_SPAN_DB, dbFraction } from './meterScale';
import { css, oklchToRgb, type FxPalette, type Rgb } from './palette';
import { blob } from './sprites';
import type { Wall } from './wall';

export const MAX_METERS = 9;

/** One pillar's identity: its colour in OKLCH (l 0..1) and where it sits. */
export interface MeterChannel {
  key: number;
  label: string;
  groupLabel: string | null;
  /** Channels sharing a group index are drawn as a pair. */
  group: number;
  l: number;
  c: number;
  h: number;
}

const CLIP_HOLD_MS = 400;
const LID_H = 3;
const LID_GAP = 2;
const PLATE_H = 2;
const TICK_DB = 6;
const HALO_W = 2.4;
const HALO_SIGMA = 0.2;
const HALO_ALPHA = 0.4;
const GLOW_RES = 0.25;
const LABEL_Y = 15;
const GROUP_LABEL_Y = 29;
const LABEL_ALPHA = 0.85;
const SCALE_DB = [0, -6, -12, -24, -48];

// Body ramp: slightly darker at the foot, slightly lighter at the top, chroma constant.
const L_FOOT = -0.04;
const L_TOP = 0.06;
const STRIPE_LIFT = 0.18;
const LIFT_DESAT = 0.8;
const LID_LIFT = 0.35;
const CAP_LIFT = 0.8;
const CAP_CHROMA = 0.04;
const TICK_SHADE = 0.2;
const CORNER = 2;

function tone(ch: MeterChannel, dl: number, lift: number, space: ColorSpace): Rgb {
  const l = Math.min(1, Math.max(0, ch.l + dl));
  return oklchToRgb(l + (1 - l) * lift, ch.c * (1 - lift * LIFT_DESAT), ch.h, space);
}

function sameChannels(a: readonly MeterChannel[], b: readonly MeterChannel[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.key !== y.key || x.label !== y.label || x.groupLabel !== y.groupLabel || x.group !== y.group) return false;
    if (x.l !== y.l || x.c !== y.c || x.h !== y.h) return false;
  }
  return true;
}

function truncate(c: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (c.measureText(text).width <= maxW) return text;
  let n = text.length;
  while (n > 1 && c.measureText(`${text.slice(0, n)}…`).width > maxW) n--;
  return `${text.slice(0, n)}…`;
}

/**
 * Level pillars standing on the floor line, one per channel in its own colour. Sprites are
 * pre-rendered at layout; a frame only blits them.
 */
export class MeterWall implements Wall {
  x = 0;
  floorY = 0;
  width = 0;
  height = 0;
  private dpr = 1;
  private slabW = 0;
  private channels: MeterChannel[] = [];
  private readonly lefts = new Float32Array(MAX_METERS);
  private bodies: HTMLCanvasElement[] = [];
  private halos: HTMLCanvasElement[] = [];
  private blobs: HTMLCanvasElement[] = [];
  private lids: HTMLCanvasElement[] = [];
  private dotColors: string[] = [];
  private cap: HTMLCanvasElement | null = null;
  private haloSize = 0;
  private now = 0;
  private readonly body = Array.from({ length: MAX_METERS }, newMeter);
  private readonly lid = Array.from({ length: MAX_METERS }, newMeter);
  private readonly clipUntil = new Float64Array(MAX_METERS);
  private readonly latch = new Uint8Array(MAX_METERS);

  /** Replaces the pillars; true when anything changed, so the caller must lay out and repaint. */
  setChannels(chs: readonly MeterChannel[]): boolean {
    const next = chs.slice(0, MAX_METERS);
    if (sameChannels(this.channels, next)) return false;
    // Pillars keep their motion across a rename or reorder when their key survives.
    const prev = this.channels;
    const body = next.map((c) => this.body[prev.findIndex((p) => p.key === c.key)] ?? newMeter());
    const lid = next.map((c) => this.lid[prev.findIndex((p) => p.key === c.key)] ?? newMeter());
    const clip = next.map((c) => this.clipUntil[prev.findIndex((p) => p.key === c.key)] ?? 0);
    const latch = next.map((c) => this.latch[prev.findIndex((p) => p.key === c.key)] ?? 0);
    this.channels = next.map((c) => ({ ...c }));
    for (let i = 0; i < MAX_METERS; i++) {
      this.body[i] = body[i] ?? newMeter();
      this.lid[i] = lid[i] ?? newMeter();
      this.clipUntil[i] = clip[i] ?? 0;
      this.latch[i] = latch[i] ?? 0;
    }
    return true;
  }

  /** Drops every pillar to silence, so the next stretch rises from zero. */
  reset(): void {
    for (let i = 0; i < MAX_METERS; i++) {
      this.body[i] = newMeter();
      this.lid[i] = newMeter();
    }
    this.clipUntil.fill(0);
    this.latch.fill(0);
  }

  layout(x: number, top: number, floorY: number, width: number, dpr: number, p: FxPalette): void {
    this.x = x;
    this.floorY = floorY;
    this.width = width;
    this.height = floorY - top;
    this.dpr = dpr;
    const sp = p.space;
    const n = this.channels.length;
    const lay = layoutMeters(this.channels.map((c) => c.group), width);
    const sw = Math.max(2, Math.round(lay.slabW * dpr)) / dpr;
    this.slabW = sw;
    for (let i = 0; i < n; i++) this.lefts[i] = Math.round((x + lay.x[i]) * dpr) / dpr;

    const H = this.height;
    this.haloSize = sw * HALO_W;
    this.bodies = [];
    this.halos = [];
    this.blobs = [];
    this.lids = [];
    this.dotColors = [];
    for (const ch of this.channels) {
      this.bodies.push(this.bodySprite(ch, sw, H, dpr, sp));
      this.halos.push(this.haloStrip(ch, sw * HALO_W, H, sp));
      this.blobs.push(blob(this.haloSize, GLOW_RES, tone(ch, 0, 0.12, sp), 0.5, sp));
      this.lids.push(this.flat(sw, LID_H, dpr, tone(ch, 0, LID_LIFT, sp), sp));
      const dh = ((25 - ch.h + 540) % 360) - 180;
      this.dotColors.push(css(oklchToRgb(Math.max(ch.l, 0.7), Math.max(ch.c, 0.16), ch.h + dh * 0.6, sp), 1, sp));
    }
    this.cap = this.flat(sw, LID_H, dpr, oklchToRgb(CAP_LIFT + (1 - CAP_LIFT) * 0.5, CAP_CHROMA, 0, sp), sp);
  }

  private flat(w: number, h: number, dpr: number, color: Rgb, sp: ColorSpace): HTMLCanvasElement {
    const [c, x] = createCanvas(w * dpr, h * dpr, sp);
    x.fillStyle = css(color, 1, sp);
    x.fillRect(0, 0, c.width, c.height);
    return c;
  }

  private bodySprite(ch: MeterChannel, w: number, H: number, dpr: number, sp: ColorSpace): HTMLCanvasElement {
    const [c, x] = createCanvas(w * dpr, H * dpr, sp);
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = x.createLinearGradient(0, H, 0, 0);
    for (let k = 0; k <= 8; k++) {
      const f = k / 8;
      g.addColorStop(f, css(tone(ch, L_FOOT + (L_TOP - L_FOOT) * f, 0, sp), 1, sp));
    }
    const r = Math.min(CORNER, w / 4);
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(0, H);
    x.lineTo(0, r);
    x.arcTo(0, 0, r, 0, r);
    x.lineTo(w - r, 0);
    x.arcTo(w, 0, w, r, r);
    x.lineTo(w, H);
    x.closePath();
    x.fill();

    x.globalCompositeOperation = 'source-atop';
    const stripe = Math.max(1 / dpr, Math.round(w * 0.3 * dpr) / dpr);
    x.fillStyle = css(tone(ch, 0, STRIPE_LIFT, sp), 0.35, sp);
    x.fillRect((w - stripe) / 2, 0, stripe, H);
    x.fillStyle = `rgba(0,0,0,${TICK_SHADE})`;
    for (let db = TICK_DB; db < VU_SPAN_DB; db += TICK_DB) {
      x.fillRect(0, Math.round((db / VU_SPAN_DB) * H * dpr) / dpr, w, 1 / dpr);
    }
    return c;
  }

  /** A column glow in the channel colour under a gaussian horizontal falloff, at glow-buffer resolution. */
  private haloStrip(ch: MeterChannel, w: number, h: number, sp: ColorSpace): HTMLCanvasElement {
    const [c, x] = createCanvas(w * GLOW_RES, h * GLOW_RES, sp);
    x.setTransform(GLOW_RES, 0, 0, GLOW_RES, 0, 0);
    const col = tone(ch, 0, 0.06, sp);
    const v = x.createLinearGradient(0, h, 0, 0);
    v.addColorStop(0, css(col, 0.7, sp));
    v.addColorStop(1, css(col, 1, sp));
    x.fillStyle = v;
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

  private cx(i: number): number {
    return this.lefts[i] + this.slabW / 2;
  }

  /** Scale at the left margin, then per pillar a base plate, its name and the pair's shared name. */
  paintLabels(c: CanvasRenderingContext2D, p: FxPalette): void {
    const sp = p.space;
    const H = this.height;
    const fy = this.floorY;
    c.font = `10px ${p.font}`;
    c.textBaseline = 'middle';
    c.textAlign = 'right';
    c.fillStyle = p.faint;
    c.globalAlpha = 0.4;
    for (const db of SCALE_DB) {
      const y = Math.round(fy - ((VU_SPAN_DB + db) / VU_SPAN_DB) * H);
      c.fillRect(this.x - 9, y, 5, 1);
      c.fillText(String(db), this.x - 13, y + 0.5);
    }

    c.textBaseline = 'alphabetic';
    c.textAlign = 'center';
    const n = this.channels.length;
    const sw = this.slabW;
    for (let i = 0; i < n; i++) {
      const ch = this.channels[i];
      c.fillStyle = css(tone(ch, 0, 0, sp), 1, sp);
      c.globalAlpha = 1;
      c.fillRect(this.lefts[i], fy, sw, PLATE_H);

      const prev = i > 0 ? this.cx(i) - this.cx(i - 1) : Infinity;
      const next = i < n - 1 ? this.cx(i + 1) - this.cx(i) : Infinity;
      c.globalAlpha = LABEL_ALPHA;
      c.fillText(truncate(c, ch.label, Math.min(prev, next, sw * 3) - 4), this.cx(i), fy + LABEL_Y);

      const first = i === 0 || this.channels[i - 1].group !== ch.group;
      const paired = i < n - 1 && this.channels[i + 1].group === ch.group;
      if (ch.groupLabel && first && paired) {
        const span = this.lefts[i + 1] + sw - this.lefts[i];
        c.fillText(truncate(c, ch.groupLabel, span + sw), this.lefts[i] + span / 2, fy + GROUP_LABEL_Y);
      }
    }
    c.globalAlpha = 1;
  }

  /** Advances every pillar. `levels` are linear peaks per slot; `latched` marks channels that clipped. */
  step(nowMs: number, dtMs: number, levels: Float32Array, latched: Uint8Array): void {
    this.now = nowMs;
    for (let i = 0; i < this.channels.length; i++) {
      const f = dbFraction(levels[i]);
      stepMeter(this.body[i], f, nowMs, dtMs, VU_BALLISTICS);
      stepMeter(this.lid[i], f, nowMs, dtMs, VU_PEAK_BALLISTICS);
      if (f >= CLIP_DB_FRACTION) this.clipUntil[i] = nowMs + CLIP_HOLD_MS;
      this.latch[i] = latched[i];
    }
  }

  /** Whether slot `i` clipped within the 400 ms before the most recent step. */
  clipping(i: number): boolean {
    return this.now < this.clipUntil[i];
  }

  energy(): number {
    let m = 0;
    for (let i = 0; i < this.channels.length; i++) if (this.body[i].level > m) m = this.body[i].level;
    return Math.min(1, m);
  }

  draw(ctx: CanvasRenderingContext2D, bloom: Bloom, decorative: boolean, alpha: number): void {
    const cap = this.cap;
    if (!cap || alpha <= 0.002) return;
    const { dpr, floorY, slabW: sw } = this;
    const H = this.height;
    const b = bloom.ctx;
    ctx.globalCompositeOperation = 'source-over';
    const hw = sw * HALO_W;
    const hs = this.haloSize;
    b.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.channels.length; i++) {
      const body = this.bodies[i];
      const x0 = this.lefts[i];
      const l = Math.min(1, this.body[i].level);
      const hh = Math.round(l * H * dpr) / dpr;

      ctx.globalAlpha = alpha;
      if (hh >= 1 / dpr) {
        const top = floorY - hh;
        const sy = (H - hh) * dpr;
        ctx.drawImage(body, 0, sy, body.width, body.height - sy, x0, top, sw, hh);
        const halo = this.halos[i];
        const gy = (H - hh) * GLOW_RES;
        b.globalAlpha = HALO_ALPHA * alpha;
        b.drawImage(halo, 0, gy, halo.width, halo.height - gy, this.cx(i) - hw / 2, top, hw, hh);
        b.globalAlpha = Math.min(1, l * 1.5) * alpha;
        b.drawImage(this.blobs[i], this.cx(i) - hs / 2, top - hs / 2, hs, hs);
      }
      if (decorative) {
        const peak = Math.min(1, this.lid[i].peak);
        if (peak > 0.01) {
          const ly = Math.round((floorY - peak * H - LID_GAP - LID_H) * dpr) / dpr;
          ctx.drawImage(this.clipping(i) ? cap : this.lids[i], x0, ly, sw, LID_H);
        }
      }
      if (this.latch[i] === 1) {
        ctx.fillStyle = this.dotColors[i];
        ctx.fillRect(this.cx(i) - 1.5, floorY - 0.5, 3, 3);
      }
    }
    ctx.globalAlpha = 1;
    b.globalAlpha = 1;
    b.globalCompositeOperation = 'source-over';
  }
}
