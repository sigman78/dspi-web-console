<script lang="ts" module>
  import type { ChannelId } from '@/domain';

  // Curve-only API. Callers provide pre-sampled magnitude points on the
  // canonical 201-bin grid (see bodeFreqs.ts). The plot is dumb about EQ
  // semantics -- it only draws.
  export type BodeCurve = {
    id: string;
    /** 201 dB samples at BODE_FREQS. Values outside yRange are clipped. */
    points: number[];
    /** Channel id whose palette colors the stroke + (single-curve) fill. */
    channelId?: ChannelId;
    label?: string;
    /** Render as dashed; pairs with `offsetPx` so coincident curves stay
     *  distinguishable from a solid twin. */
    dashed?: boolean;
    /** Render the stroke as a horizontal gradient between two channels'
     *  palette colors (left-edge -> right-edge of the plot). Used to depict
     *  a stereo-locked pair as a single line whose color fades between the
     *  two channels. */
    gradientChannelIds?: [ChannelId, ChannelId];
    /** Vertical pixel nudge applied to the path. Default 0. */
    offsetPx?: number;
  };

  // Optional EQ-style band markers drawn on top of the curves.
  export type BodeMarker = {
    id?: string;
    f: number;
    db: number;
    channelId?: ChannelId;
    label?: string;
  };
</script>

<script lang="ts">
  import { BODE_BINS, fForXNorm, nearestBinIndex } from './bodeFreqs';
  import { Eq } from '@/domain';
  import { chShade } from '@/styles/palette';

  const {
    curves,
    markers = [],
    yRange = [Eq.BODE_DB_RANGE[0], Eq.BODE_DB_RANGE[1]] as [number, number],
    height = 220,
    crosshair = true,
  }: {
    curves: BodeCurve[];
    markers?: BodeMarker[];
    yRange?: [number, number];
    height?: number;
    crosshair?: boolean;
  } = $props();

  // Internal coordinate system. W tracks the wrapper's measured pixel width
  // (via bind:clientWidth) so the viewBox matches the rendered size 1:1 --
  // no x-stretch of strokes or text on wide containers.
  const PAD_L = 30;
  const PAD_B = 16;
  let containerW = $state(720);
  const W = $derived(Math.max(120, containerW));

  const yMin = $derived(yRange[0]);
  const yMax = $derived(yRange[1]);
  const plotW = $derived(W - PAD_L);
  const plotH = $derived(height - PAD_B);

  // Pre-mapped x-coords for the 201 bins (constant once W/PAD_L are fixed).
  const binsX = $derived.by(() => {
    const out = new Array<number>(BODE_BINS);
    for (let i = 0; i < BODE_BINS; i++) {
      out[i] = PAD_L + (i / (BODE_BINS - 1)) * plotW;
    }
    return out;
  });

  function yForDb(db: number): number {
    return plotH - ((db - yMin) / (yMax - yMin)) * plotH;
  }
  function xNormForFLocal(f: number): number {
    return Math.log(f / Eq.FREQ_MIN_HZ) / Math.log(Eq.FREQ_MAX_HZ / Eq.FREQ_MIN_HZ);
  }
  function xForF(f: number): number {
    return PAD_L + xNormForFLocal(f) * plotW;
  }

  // Catmull-Rom -> cubic Bezier path. Input is 201 sampled points already
  // aligned to binsX. Tension fixed (alpha = 0.5 equivalent).
  function catmullRomPath(pts: ReadonlyArray<[number, number]>): string {
    const n = pts.length;
    if (n === 0) return '';
    if (n === 1) return `M ${pts[0][0]} ${pts[0][1]}`;
    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 0; i < n - 1; i++) {
      const p0 = pts[i === 0 ? 0 : i - 1];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2 < n ? i + 2 : n - 1];
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2[0]} ${p2[1]}`;
    }
    return d;
  }

  function strokeFor(c: BodeCurve): string {
    if (c.gradientChannelIds) return `url(#bodeGrad-${c.id})`;
    return c.channelId != null ? chShade(c.channelId, 'bright') : 'var(--accent)';
  }
  function fillStopFor(c: BodeCurve): string {
    return c.channelId != null ? chShade(c.channelId, 'bright') : 'var(--accent)';
  }
  function gradientChannelColor(id: ChannelId): string {
    return chShade(id, 'bright');
  }

  // Build path data per curve (memoized via $derived on curves).
  const built = $derived.by(() => {
    return curves.map((c) => {
      const off = c.offsetPx ?? 0;
      const pts: Array<[number, number]> = new Array(BODE_BINS);
      for (let i = 0; i < BODE_BINS; i++) {
        pts[i] = [binsX[i], yForDb(c.points[i] ?? 0) + off];
      }
      return { c, d: catmullRomPath(pts), pts };
    });
  });

  // Z-order: dashed curves under solid ones, otherwise array order.
  const dashed = $derived(built.filter((b) => b.c.dashed));
  const solid = $derived(built.filter((b) => !b.c.dashed));
  const single = $derived(curves.length === 1);

  // Static axis tick lists.
  const F_MAJOR = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  const F_MINOR: number[] = (() => {
    const set = new Set(F_MAJOR);
    const out: number[] = [];
    for (const dec of [10, 100, 1000, 10000]) {
      for (let m = 2; m <= 9; m++) {
        const f = dec * m;
        if (f >= Eq.FREQ_MIN_HZ && f <= Eq.FREQ_MAX_HZ && !set.has(f)) out.push(f);
      }
    }
    return out;
  })();

  const yTicks = $derived.by(() => {
    // Pick a "nice" step (1, 2, 5, 10, 20...) so labels are round dB
    // values, then emit every multiple of step that falls inside yRange.
    // Targets ~5 ticks. Always includes 0 if 0 is in range.
    const span = yMax - yMin;
    const rough = span / 4;
    const pow10 = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / pow10;
    const niceNorm = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
    const step = niceNorm * pow10;
    const start = Math.ceil(yMin / step) * step;
    const out: number[] = [];
    for (let v = start; v <= yMax + 1e-9; v += step) {
      out.push(Math.round(v * 1e6) / 1e6);
    }
    return out;
  });

  function fmtFreqLabel(f: number): string {
    if (f >= 1000) {
      const k = f / 1000;
      return Number.isInteger(k) ? `${k}k` : `${k}k`;
    }
    return String(f);
  }
  function fmtFreqReadout(f: number): string {
    if (f >= 1000) return `${(f / 1000).toFixed(2)} kHz`;
    return `${Math.round(f)} Hz`;
  }
  function fmtDbReadout(db: number): string {
    const s = db >= 0 ? '+' : '';
    return `${s}${db.toFixed(1)} dB`;
  }

  // Crosshair state (in internal coords). Hidden when null.
  let cx = $state<number | null>(null);
  let cy = $state<number | null>(null);
  let svgEl = $state<SVGSVGElement | null>(null);

  function onMove(e: PointerEvent) {
    if (!crosshair || !svgEl) return;
    const r = svgEl.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const sx = (e.clientX - r.left) / r.width;
    const sy = (e.clientY - r.top) / r.height;
    // Map to internal coords.
    let ix = sx * W;
    const iy = sy * height;
    if (ix < PAD_L || ix > W || iy < 0 || iy > plotH) {
      cx = null;
      cy = null;
      return;
    }
    // Snap x to nearest of the 201 bins.
    const xn = (ix - PAD_L) / plotW;
    const bin = Math.max(0, Math.min(BODE_BINS - 1, Math.round(xn * (BODE_BINS - 1))));
    ix = binsX[bin];
    cx = ix;
    cy = iy;
  }
  function onLeave() {
    cx = null;
    cy = null;
  }

  // Crosshair readout values.
  const cFreq = $derived.by(() => {
    if (cx == null) return null;
    const xn = (cx - PAD_L) / plotW;
    return fForXNorm(Math.max(0, Math.min(1, xn)));
  });
  const cDb = $derived.by(() => {
    if (cy == null) return null;
    const t = (plotH - cy) / plotH;
    return yMin + t * (yMax - yMin);
  });

  // Clamp readout badge inside the plot.
  function badgeX(x: number): number {
    return Math.max(PAD_L + 4, Math.min(W - 90, x + 6));
  }
  function badgeY(y: number): number {
    return Math.max(14, Math.min(plotH - 6, y - 8));
  }

  void nearestBinIndex; // re-export tag for tree-shake friendliness
</script>

<div class="bode-wrap" bind:clientWidth={containerW}>
<svg
  bind:this={svgEl}
  class="bode"
  viewBox={`0 0 ${W} ${height}`}
  width="100%"
  {height}
  role="img"
  aria-label="Frequency response plot"
  onpointermove={onMove}
  onpointerleave={onLeave}
>
  <defs>
    {#if single && curves[0]}
      <linearGradient id="bodeFill-{curves[0].id}" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color={fillStopFor(curves[0])} stop-opacity="0.25" />
        <stop offset="100%" stop-color={fillStopFor(curves[0])} stop-opacity="0" />
      </linearGradient>
    {/if}
    {#each curves as c (c.id)}
      {#if c.gradientChannelIds}
        <linearGradient
          id="bodeGrad-{c.id}"
          gradientUnits="userSpaceOnUse"
          x1={PAD_L} x2={W} y1={0} y2={0}
        >
          <stop offset="0%" stop-color={gradientChannelColor(c.gradientChannelIds[0])} />
          <stop offset="100%" stop-color={gradientChannelColor(c.gradientChannelIds[1])} />
        </linearGradient>
      {/if}
    {/each}
  </defs>

  <!-- Minor (log) vertical lines -->
  {#each F_MINOR as f (f)}
    <line
      x1={xForF(f)} x2={xForF(f)} y1={0} y2={plotH}
      stroke="color-mix(in oklab, var(--text) 3.5%, transparent)" stroke-width="0.5"
      vector-effect="non-scaling-stroke"
    />
  {/each}

  <!-- Horizontal dB lines + labels -->
  {#each yTicks as db (db)}
    {@const y = yForDb(db)}
    <line
      x1={PAD_L} x2={W} y1={y} y2={y}
      stroke={db === 0
        ? 'color-mix(in oklab, var(--text) 18%, transparent)'
        : 'color-mix(in oklab, var(--text) 5%, transparent)'}
      stroke-dasharray={db === 0 ? '' : '2 4'}
      stroke-width={db === 0 ? 1 : 0.5}
      vector-effect="non-scaling-stroke"
    />
    <text
      x={PAD_L - 4} y={y + 3} text-anchor="end" font-size="9"
      fill="color-mix(in oklab, var(--text) 40%, transparent)" font-family="var(--font-mono)"
    >
      {db > 0 ? '+' : ''}{db}
    </text>
  {/each}

  <!-- Major decade lines + labels -->
  {#each F_MAJOR as f (f)}
    {@const x = xForF(f)}
    <line
      x1={x} x2={x} y1={0} y2={plotH}
      stroke="color-mix(in oklab, var(--text) 10%, transparent)" stroke-width="0.6"
      vector-effect="non-scaling-stroke"
    />
    <text
      x={x - 2} y={plotH + 12} text-anchor="end" font-size="9"
      fill="color-mix(in oklab, var(--text) 55%, transparent)" font-family="var(--font-mono)"
    >
      {fmtFreqLabel(f)}
    </text>
  {/each}

  <!-- Single-curve fill -->
  {#if single && solid[0]}
    <path
      d={solid[0].d + ` L ${W} ${plotH} L ${PAD_L} ${plotH} Z`}
      fill="url(#bodeFill-{curves[0].id})"
      vector-effect="non-scaling-stroke"
    />
  {/if}

  <!-- Dashed curves first (under) -->
  {#each dashed as b (b.c.id)}
    <path
      d={b.d}
      fill="none"
      stroke={strokeFor(b.c)}
      stroke-width="1.4"
      stroke-opacity="0.85"
      stroke-dasharray="4 3"
      stroke-linecap="round"
      vector-effect="non-scaling-stroke"
    />
  {/each}

  <!-- Solid curves on top -->
  {#each solid as b (b.c.id)}
    <path
      d={b.d}
      fill="none"
      stroke={strokeFor(b.c)}
      stroke-width="1.6"
      stroke-linecap="round"
      vector-effect="non-scaling-stroke"
    />
  {/each}

  <!-- Markers (e.g. EQ band positions) -->
  {#each markers as m, i (m.id ?? i)}
    {@const mx = xForF(Math.max(Eq.FREQ_MIN_HZ, Math.min(Eq.FREQ_MAX_HZ, m.f)))}
    {@const my = yForDb(Math.max(yMin, Math.min(yMax, m.db)))}
    {@const mc = m.channelId != null
      ? chShade(m.channelId, 'bright')
      : 'color-mix(in oklab, var(--text) 85%, transparent)'}
    <line
      x1={mx} x2={mx} y1={my} y2={plotH}
      stroke={mc} stroke-opacity="0.25" stroke-dasharray="2 3"
      vector-effect="non-scaling-stroke" pointer-events="none"
    />
    <circle cx={mx} cy={my} r="3.5" fill={mc} stroke="var(--bg)" stroke-width="1.2" pointer-events="none" />
    {#if m.label}
      <text
        x={mx} y={my - 6} text-anchor="middle" font-size="9"
        fill="color-mix(in oklab, var(--text) 70%, transparent)" font-family="var(--font-mono)" pointer-events="none"
      >
        {m.label}
      </text>
    {/if}
  {/each}

  <!-- Crosshair -->
  {#if crosshair && cx != null && cy != null && cFreq != null && cDb != null}
    <line
      x1={cx} x2={cx} y1={0} y2={plotH}
      stroke="color-mix(in oklab, var(--text) 35%, transparent)" stroke-width="0.7"
      stroke-dasharray="2 3"
      vector-effect="non-scaling-stroke" pointer-events="none"
    />
    <line
      x1={PAD_L} x2={W} y1={cy} y2={cy}
      stroke="color-mix(in oklab, var(--text) 25%, transparent)" stroke-width="0.7"
      stroke-dasharray="2 3"
      vector-effect="non-scaling-stroke" pointer-events="none"
    />
    <g pointer-events="none" transform={`translate(${badgeX(cx)} ${badgeY(cy)})`}>
      <rect
        x="0" y="-11" width="86" height="14" rx="2"
        fill="var(--panel-hi)"
        stroke="var(--border-hi)" stroke-width="0.6"
      />
      <text
        x="5" y="-1" font-size="9" font-family="var(--font-mono)"
        fill="color-mix(in oklab, var(--text) 92%, transparent)"
      >
        {fmtFreqReadout(cFreq)} · {fmtDbReadout(cDb)}
      </text>
    </g>
  {/if}
</svg>
</div>

<style>
  .bode-wrap {
    width: 100%;
  }
  .bode {
    display: block;
    touch-action: none;
    user-select: none;
  }
</style>
