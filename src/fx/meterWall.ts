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
/** The span is cut into this many equal blocks (3 dB each). */
const SEGMENTS = 20;
const GAP = 3;
const LID_H = 2;
const PLATE_H = 2;
const HALO_W = 2;
const HALO_SIGMA = 0.2;
const HALO_ALPHA = 0.58;
const HALO_GAP_CUT = 0.5;
const GLOW_RES = 0.25;
const SCALE_DB = [0, -6, -12, -24, -48];

// Body ramp: noticeably darker at the foot, lighter at the top, a little richer than the palette.
const L_FOOT = -0.1;
const L_TOP = 0.08;
const CHROMA_GAIN = 1.18;
const STRIPE_LIFT = 0.18;
const STRIPE_ALPHA = 0.2;
const LIFT_DESAT = 0.8;
const LID_LIFT = 0.35;
const CAP_LIFT = 0.8;
const CAP_CHROMA = 0.04;
/** The topmost lit block is lifted toward white by this much. */
const TIP_FILL = 'rgba(255,255,255,0.16)';

// Labels under the floor line, drawn above the reflection.
const BLOCK_TOP = 4;
const BLOCK_H = 17;
const BLOCK_GAP = 2;
const TEXT_OUTLINE = 'rgba(0,0,0,0.9)';
const TEXT_OUTLINE_W = 3;
const BLOCK_PAD = 6;
const BLOCK_SPACE = 3;
const BLOCK_FONT = 11;

function tone(ch: MeterChannel, dl: number, lift: number, space: ColorSpace): Rgb {
  const l = Math.min(1, Math.max(0, ch.l + dl));
  return oklchToRgb(l + (1 - l) * lift, ch.c * CHROMA_GAIN * (1 - lift * LIFT_DESAT), ch.h, space);
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

/** `text` shortened with an ellipsis to fit `maxW`; empty when not even one letter and the ellipsis fit. */
function truncate(c: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (c.measureText(text).width <= maxW) return text;
  for (let n = text.length - 1; n >= 1; n--) {
    const cut = `${text.slice(0, n)}\u2026`;
    if (c.measureText(cut).width <= maxW) return cut;
  }
  return '';
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
  private heightPx = 0;
  private gapPx = 0;
  private lidPx = 0;
  private readonly bounds = new Int32Array(SEGMENTS + 1);
  private nameBlocks: HTMLCanvasElement[] = [];
  private groupBlocks: (HTMLCanvasElement | null)[] = [];
  private pal: FxPalette | null = null;
  private readonly onFonts = (): void => {
    if (this.pal && this.channels.length > 0) this.buildLabels(this.pal);
  };

  constructor() {
    // Label text is baked into sprites, so it is redrawn once the UI font has arrived.
    if (typeof document !== 'undefined' && document.fonts) document.fonts.addEventListener('loadingdone', this.onFonts);
  }

  dispose(): void {
    if (typeof document !== 'undefined' && document.fonts) document.fonts.removeEventListener('loadingdone', this.onFonts);
  }
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

    // Block boundaries in device pixels from the floor; every sprite and crop uses these.
    this.gapPx = Math.max(1, Math.round(GAP * dpr));
    const hpx = Math.max(SEGMENTS * (this.gapPx + 1), Math.round(this.height * dpr));
    this.heightPx = hpx;
    this.lidPx = Math.max(1, Math.min(this.gapPx, Math.round(LID_H * dpr)));
    for (let k = 0; k <= SEGMENTS; k++) this.bounds[k] = Math.round((k * hpx) / SEGMENTS);

    this.haloSize = sw * HALO_W;
    this.bodies = [];
    this.halos = [];
    this.blobs = [];
    this.lids = [];
    this.dotColors = [];
    for (let i = 0; i < n; i++) {
      const ch = this.channels[i];
      this.bodies.push(this.bodySprite(ch, sw, sp));
      this.halos.push(this.haloStrip(ch, sw * HALO_W, sp));
      this.blobs.push(blob(this.haloSize, GLOW_RES, tone(ch, 0, 0.12, sp), 0.5, sp));
      this.lids.push(this.flat(sw, this.lidPx, tone(ch, 0, LID_LIFT, sp), sp));
      const dh = ((25 - ch.h + 540) % 360) - 180;
      this.dotColors.push(css(oklchToRgb(Math.max(ch.l, 0.7), Math.max(ch.c, 0.16), ch.h + dh * 0.6, sp), 1, sp));

    }
    this.pal = p;
    this.buildLabels(p);
    this.cap = this.flat(sw, this.lidPx, oklchToRgb(CAP_LIFT + (1 - CAP_LIFT) * 0.5, CAP_CHROMA, 0, sp), sp);
  }

  /** A flat sprite `w` css px wide and `hpx` device px tall. */
  private flat(w: number, hpx: number, color: Rgb, sp: ColorSpace): HTMLCanvasElement {
    const [c, x] = createCanvas(w * this.dpr, hpx, sp);
    x.fillStyle = css(color, 1, sp);
    x.fillRect(0, 0, c.width, c.height);
    return c;
  }

  /** Full-height pillar in device pixels, cut into blocks by transparent gaps above each block. */
  private bodySprite(ch: MeterChannel, w: number, sp: ColorSpace): HTMLCanvasElement {
    const hpx = this.heightPx;
    const [c, x] = createCanvas(w * this.dpr, hpx, sp);
    const g = x.createLinearGradient(0, hpx, 0, 0);
    for (let k = 0; k <= 8; k++) {
      const f = k / 8;
      g.addColorStop(f, css(tone(ch, L_FOOT + (L_TOP - L_FOOT) * f, 0, sp), 1, sp));
    }
    x.fillStyle = g;
    x.fillRect(0, 0, c.width, hpx);
    const stripe = Math.max(1, Math.round(c.width * 0.3));
    x.fillStyle = css(tone(ch, 0, STRIPE_LIFT, sp), STRIPE_ALPHA, sp);
    x.fillRect(Math.floor((c.width - stripe) / 2), 0, stripe, hpx);
    x.globalCompositeOperation = 'destination-out';
    x.fillStyle = '#000';
    for (let k = 0; k < SEGMENTS; k++) x.fillRect(0, hpx - this.bounds[k + 1], c.width, this.gapPx);
    return c;
  }

  /** A column glow in the channel colour under a gaussian horizontal falloff, gaps softly cut, at glow-buffer resolution. */
  private haloStrip(ch: MeterChannel, w: number, sp: ColorSpace): HTMLCanvasElement {
    const h = this.heightPx / this.dpr;
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
    x.globalCompositeOperation = 'destination-out';
    x.fillStyle = `rgba(0,0,0,${HALO_GAP_CUT})`;
    for (let k = 0; k < SEGMENTS; k++) x.fillRect(0, (this.heightPx - this.bounds[k + 1]) / this.dpr, w, this.gapPx / this.dpr);
    return c;
  }

  /** Name and group labels as sprites; a name label grows past its slab, up to the neighbour spacing, to fit its text. */
  private buildLabels(p: FxPalette): void {
    const dpr = this.dpr;
    const n = this.channels.length;
    const sw = this.slabW;
    const [, m] = createCanvas(1, 1, p.space);
    m.font = `${BLOCK_FONT}px ${p.font}`;
    this.nameBlocks = [];
    this.groupBlocks = [];
    for (let i = 0; i < n; i++) {
      const ch = this.channels[i];
      const col = css(tone(ch, 0, 0, p.space), 1, p.space);
      const prev = i > 0 ? this.cx(i) - this.cx(i - 1) : Infinity;
      const next = i < n - 1 ? this.cx(i + 1) - this.cx(i) : Infinity;
      const most = Math.max(sw, Math.min(prev, next, sw * 3) - BLOCK_SPACE);
      const w = Math.round(Math.min(most, Math.max(sw, m.measureText(ch.label).width + BLOCK_PAD)) * dpr) / dpr;
      this.nameBlocks.push(this.labelSprite(ch.label, w, col, p));
      const first = i === 0 || this.channels[i - 1].group !== ch.group;
      const paired = i < n - 1 && this.channels[i + 1].group === ch.group;
      if (ch.groupLabel && first && paired) {
        const span = this.lefts[i + 1] + sw - this.lefts[i];
        this.groupBlocks.push(this.labelSprite(ch.groupLabel, span, col, p));
      } else {
        this.groupBlocks.push(null);
      }
    }
  }

  /** `text` in `color` with a black outline for contrast, `w` css px wide, shortened to fit. */
  private labelSprite(text: string, w: number, color: string, p: FxPalette): HTMLCanvasElement {
    const dpr = this.dpr;
    const [c, x] = createCanvas(w * dpr, BLOCK_H * dpr, p.space);
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.font = `${BLOCK_FONT}px ${p.font}`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    const t = truncate(x, text, w - BLOCK_PAD);
    const ty = BLOCK_H / 2 + 0.5;
    x.lineJoin = 'round';
    x.lineWidth = TEXT_OUTLINE_W;
    x.strokeStyle = TEXT_OUTLINE;
    x.strokeText(t, w / 2, ty);
    x.fillStyle = color;
    x.fillText(t, w / 2, ty);
    return c;
  }

  private cx(i: number): number {
    return this.lefts[i] + this.slabW / 2;
  }

  /** Scale ticks at block boundaries in the left margin, and a base plate under each pillar. */
  paintLabels(c: CanvasRenderingContext2D, p: FxPalette): void {
    const sp = p.space;
    const fy = this.floorY;
    c.font = `10px ${p.font}`;
    c.textBaseline = 'middle';
    c.textAlign = 'right';
    c.fillStyle = p.faint;
    c.globalAlpha = 0.4;
    for (const db of SCALE_DB) {
      const y = Math.round(fy - this.bounds[Math.round((VU_SPAN_DB + db) / (VU_SPAN_DB / SEGMENTS))] / this.dpr);
      c.fillRect(this.x - 9, y, 5, 1);
      c.fillText(String(db), this.x - 13, y + 0.5);
    }
    for (let i = 0; i < this.channels.length; i++) {
      c.fillStyle = css(tone(this.channels[i], 0, 0, sp), 1, sp);
      c.globalAlpha = 1;
      c.fillRect(this.lefts[i], fy, this.slabW, PLATE_H);
    }
    c.globalAlpha = 1;
  }

  /** Name labels under the floor line; drawn after the reflection so it cannot tint them. */
  drawLabels(ctx: CanvasRenderingContext2D, alpha: number): void {
    const y = this.floorY + BLOCK_TOP;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alpha;
    for (let i = 0; i < this.channels.length; i++) {
      const nb = this.nameBlocks[i];
      const nw = nb.width / this.dpr;
      ctx.drawImage(nb, Math.round((this.cx(i) - nw / 2) * this.dpr) / this.dpr, y, nw, BLOCK_H);
      const g = this.groupBlocks[i];
      if (g) ctx.drawImage(g, this.lefts[i], y + BLOCK_H + BLOCK_GAP, g.width / this.dpr, BLOCK_H);
    }
    ctx.globalAlpha = 1;
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

  /** Lit blocks below the level, the block holding it fading in, the topmost two lifted; glow and lid on top. */
  draw(ctx: CanvasRenderingContext2D, bloom: Bloom, decorative: boolean, alpha: number): void {
    const cap = this.cap;
    if (!cap || alpha <= 0.002) return;
    const { dpr, floorY, slabW: sw, bounds, gapPx, heightPx: hpx } = this;
    const count = this.channels.length;
    const b = bloom.ctx;
    const hw = sw * HALO_W;
    const hs = this.haloSize;
    ctx.globalCompositeOperation = 'source-over';
    b.globalCompositeOperation = 'lighter';
    ctx.fillStyle = TIP_FILL;
    for (let i = 0; i < count; i++) {
      const body = this.bodies[i];
      const x0 = this.lefts[i];
      const level = Math.min(1, this.body[i].level);
      const f = level * SEGMENTS;
      const n = Math.min(SEGMENTS, Math.floor(f));
      const frac = n < SEGMENTS ? f - n : 0;
      const partial = frac > 0.02;

      ctx.globalCompositeOperation = 'source-over';
      if (n > 0) {
        const top = bounds[n] - gapPx;
        ctx.globalAlpha = alpha;
        ctx.drawImage(body, 0, hpx - top, body.width, top, x0, floorY - top / dpr, sw, top / dpr);
      }
      if (partial) {
        const lo = bounds[n];
        const top = bounds[n + 1] - gapPx;
        ctx.globalAlpha = alpha * frac;
        ctx.drawImage(body, 0, hpx - top, body.width, top - lo, x0, floorY - top / dpr, sw, (top - lo) / dpr);
      }
      // The lift follows the fade between the two top blocks, so it never jumps at a crossing.
      ctx.globalCompositeOperation = 'lighter';
      if (n > 0) {
        ctx.globalAlpha = alpha * (partial ? 1 - frac : 1);
        ctx.fillRect(x0, floorY - (bounds[n] - gapPx) / dpr, sw, (bounds[n] - gapPx - bounds[n - 1]) / dpr);
      }
      if (partial) {
        ctx.globalAlpha = alpha * frac;
        ctx.fillRect(x0, floorY - (bounds[n + 1] - gapPx) / dpr, sw, (bounds[n + 1] - gapPx - bounds[n]) / dpr);
      }
      ctx.globalCompositeOperation = 'source-over';

      // Glow follows the continuous level, not the block edges.
      const levelPx = n < SEGMENTS ? bounds[n] + frac * (bounds[n + 1] - bounds[n]) : hpx;
      if (levelPx >= 1) {
        const halo = this.halos[i];
        const gy = (1 - levelPx / hpx) * halo.height;
        const top = floorY - levelPx / dpr;
        b.globalAlpha = HALO_ALPHA * alpha;
        b.drawImage(halo, 0, gy, halo.width, halo.height - gy, this.cx(i) - hw / 2, top, hw, levelPx / dpr);
        b.globalAlpha = Math.min(1, level * 1.5) * alpha;
        b.drawImage(this.blobs[i], this.cx(i) - hs / 2, top - hs / 2, hs, hs);
      }
      if (decorative) {
        const peak = Math.min(1, this.lid[i].peak);
        if (peak > 0.01) {
          // Same threshold as the body: the lid never floats above an empty block.
          const slot = Math.min(SEGMENTS - 1, Math.max(0, Math.ceil(peak * SEGMENTS - 0.02) - 1));
          ctx.globalAlpha = alpha;
          ctx.drawImage(this.clipping(i) ? cap : this.lids[i], x0, floorY - bounds[slot + 1] / dpr, sw, this.lidPx / dpr);
        }
      }
    }
    for (let i = 0; i < count; i++) {
      if (this.latch[i] !== 1) continue;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = this.dotColors[i];
      ctx.fillRect(this.cx(i) - 1.5, floorY - 0.5, 3, 3);
    }
    ctx.globalAlpha = 1;
    b.globalAlpha = 1;
    b.globalCompositeOperation = 'source-over';
  }
}
