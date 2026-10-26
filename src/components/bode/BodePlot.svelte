<script lang="ts" module>
  import type { ChannelId } from '@/domain';

  /** Plot margins in px (left axis labels, bottom frequency labels). */
  export const PAD_L = 30;
  export const PAD_B = 16;

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
    /** Render the stroke as a horizontal gradient between two channels'
     *  palette colors (left-edge -> right-edge of the plot). Used to depict
     *  a stereo-locked pair as a single line whose color fades between the
     *  two channels. */
    gradientChannelIds?: [ChannelId, ChannelId];
    /** Explicit stroke/fill color, wins over channelId/gradientChannelIds/default. */
    color?: string;
  };

  // Optional EQ-style band markers drawn on top of the curves.
  export type BodeMarker = {
    id?: string;
    f: number;
    db: number;
    channelId?: ChannelId;
    label?: string;
  };

  // Draggable EQ-band node drawn above curves and markers.
  export type BodeNode = {
    id: string;
    f: number;
    db: number;
    label?: string;
    channelId?: ChannelId;
    shape?: 'circle' | 'diamond';
    selected?: boolean;
    bypassed?: boolean;
    /** Node moves in frequency only. */
    lockDb?: boolean;
  };
</script>

<script lang="ts">
  import { BODE_BINS, fForXNorm } from './bodeFreqs';
  import { Eq } from '@/domain';
  import { chShade } from '@/styles/palette';
  import * as math from './eqGraphMath';

  const {
    curves,
    markers = [],
    yRange = [Eq.BODE_DB_RANGE[0], Eq.BODE_DB_RANGE[1]] as [number, number],
    height = 220,
    crosshair = true,
    nodes = [],
    onNodeSelect,
    onNodeDrag,
    onNodeDragEnd,
    onNodeWheel,
    onNodeContext,
    onPlotDblClick,
  }: {
    curves: BodeCurve[];
    markers?: BodeMarker[];
    yRange?: [number, number];
    height?: number;
    crosshair?: boolean;
    nodes?: BodeNode[];
    onNodeSelect?: (id: string) => void;
    /** Live values while dragging or nudging. The parent should render `nodes`
     *  from its own drag draft during a drag so the node tracks the pointer. */
    onNodeDrag?: (id: string, f: number, db: number) => void;
    /** Fires once at the end of a drag that moved, or once per keyboard nudge
     *  burst (on arrow keyup / blur). Not fired for a plain click. */
    onNodeDragEnd?: (id: string, f: number, db: number) => void;
    onNodeWheel?: (id: string, deltaY: number) => void;
    onNodeContext?: (id: string, clientX: number, clientY: number) => void;
    onPlotDblClick?: (f: number, db: number) => void;
  } = $props();

  // Internal coordinate system. W tracks the wrapper's measured pixel width
  // (via bind:clientWidth) so the viewBox matches the rendered size 1:1 --
  // no x-stretch of strokes or text on wide containers.
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

  const geom = $derived<math.PlotGeometry>({ padL: PAD_L, plotW, plotH, yMin, yMax });
  function yForDb(db: number): number {
    return math.yForDb(db, geom);
  }
  function xForF(f: number): number {
    return math.xForF(f, geom);
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
    if (c.color) return c.color;
    if (c.gradientChannelIds) return `url(#bodeGrad-${c.id})`;
    return c.channelId != null ? chShade(c.channelId, 'bright') : 'var(--accent)';
  }
  function fillStopFor(c: BodeCurve): string {
    if (c.color) return c.color;
    return c.channelId != null ? chShade(c.channelId, 'bright') : 'var(--accent)';
  }
  function gradientChannelColor(id: ChannelId): string {
    return chShade(id, 'bright');
  }

  const built = $derived.by(() => {
    return curves.map((c) => {
      const pts: Array<[number, number]> = new Array(BODE_BINS);
      for (let i = 0; i < BODE_BINS; i++) {
        pts[i] = [binsX[i], yForDb(c.points[i] ?? 0)];
      }
      return { c, d: catmullRomPath(pts), pts };
    });
  });

  const single = $derived(curves.length === 1);

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
      return `${f / 1000}k`;
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

  // Unique per mounted instance so multiple plots on one page (Overview,
  // per-channel EQ tabs, ...) don't collide on the clipPath id.
  const clipId = `bode-plot-clip-${Math.random().toString(36).slice(2)}`;

  // Crosshair state (in internal coords). Hidden when null.
  let cx = $state<number | null>(null);
  let cy = $state<number | null>(null);
  let svgEl = $state<SVGSVGElement | null>(null);

  // Pointer position in viewBox coordinates, or null while unmeasured.
  function toPlotXY(e: { clientX: number; clientY: number }): { x: number; y: number } | null {
    if (!svgEl) return null;
    const r = svgEl.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return {
      x: ((e.clientX - r.left) / r.width) * W,
      y: ((e.clientY - r.top) / r.height) * height,
    };
  }

  let dragId = $state<string | null>(null);
  let lastDrag: { f: number; db: number } | null = null;
  // Keyboard nudge accumulator: advanced on each (auto-repeat) keydown,
  // committed once on keyup/blur.
  let kbDraft: { id: string; f: number; db: number } | null = null;

  // A dragged node that disappears must not leave the plot stuck in drag mode.
  $effect(() => {
    if (dragId != null && !nodes.some((n) => n.id === dragId)) {
      dragId = null;
      lastDrag = null;
    }
  });

  function nodeColor(n: BodeNode): string {
    return n.channelId != null ? chShade(n.channelId, 'bright') : 'var(--accent)';
  }
  function nodeX(n: BodeNode): number {
    return xForF(Math.max(Eq.FREQ_MIN_HZ, Math.min(Eq.FREQ_MAX_HZ, n.f)));
  }
  function nodeY(n: BodeNode): number {
    return yForDb(Math.max(yMin, Math.min(yMax, n.db)));
  }

  function onNodeDown(e: PointerEvent, n: BodeNode) {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragId = n.id;
    lastDrag = null;
    cx = null;
    cy = null;
    onNodeSelect?.(n.id);
  }
  function onNodeMove(e: PointerEvent, n: BodeNode) {
    if (dragId !== n.id) return;
    const p = toPlotXY(e);
    if (!p) return;
    lastDrag = math.dragToParams(n, p.x, p.y, geom);
    onNodeDrag?.(n.id, lastDrag.f, lastDrag.db);
  }
  function endDrag(e: PointerEvent, n: BodeNode) {
    if (dragId !== n.id) return;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    const last = lastDrag;
    dragId = null;
    lastDrag = null;
    if (last) onNodeDragEnd?.(n.id, last.f, last.db);
  }
  function onNodeWheelEvt(e: WheelEvent, n: BodeNode) {
    if (!onNodeWheel) return;
    e.preventDefault();
    onNodeWheel(n.id, e.deltaY);
  }
  function onNodeCtx(e: MouseEvent, n: BodeNode) {
    e.preventDefault();
    onNodeContext?.(n.id, e.clientX, e.clientY);
  }
  function onNodeKey(e: KeyboardEvent, n: BodeNode) {
    const base = kbDraft && kbDraft.id === n.id ? kbDraft : { id: n.id, f: n.f, db: n.db };
    const next = math.nudgeParams({ ...base, lockDb: n.lockDb }, e.key, e.shiftKey, geom);
    if (!next) return;
    e.preventDefault();
    kbDraft = { id: n.id, ...next };
    onNodeDrag?.(n.id, next.f, next.db);
  }
  function flushNudge() {
    const d = kbDraft;
    kbDraft = null;
    if (d) onNodeDragEnd?.(d.id, d.f, d.db);
  }
  function onNodeKeyUp(e: KeyboardEvent) {
    if (e.key.startsWith('Arrow')) flushNudge();
  }
  function onSvgDblClick(e: MouseEvent) {
    if (!onPlotDblClick) return;
    const p = toPlotXY(e);
    if (!p || p.x < PAD_L || p.y < 0 || p.y > plotH) return;
    onPlotDblClick(math.fForX(p.x, geom), math.dbForY(p.y, geom));
  }
  function nodeAria(n: BodeNode): string {
    return `${n.label ?? ''} ${Math.round(n.f)} Hz ${n.db.toFixed(1)} dB`.trim();
  }

  function onMove(e: PointerEvent) {
    if (!crosshair || !svgEl || dragId != null) return;
    const r = svgEl.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const sx = (e.clientX - r.left) / r.width;
    const sy = (e.clientY - r.top) / r.height;
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
</script>

<div class="bode-wrap" bind:clientWidth={containerW}>
<svg
  bind:this={svgEl}
  class="bode"
  viewBox={`0 0 ${W} ${height}`}
  width="100%"
  {height}
  role={nodes.length ? 'group' : 'img'}
  aria-label="Frequency response plot"
  onpointermove={onMove}
  onpointerleave={onLeave}
  ondblclick={onSvgDblClick}
>
  <defs>
    <clipPath id={clipId}>
      <rect x={PAD_L} y="0" width={plotW} height={plotH} />
    </clipPath>
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

  {#each F_MINOR as f (f)}
    <line
      x1={xForF(f)} x2={xForF(f)} y1={0} y2={plotH}
      stroke="color-mix(in oklab, var(--text) 3.5%, transparent)" stroke-width="0.5"
      vector-effect="non-scaling-stroke"
    />
  {/each}

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

  <!-- Curve stroke/fill and band markers can extend past yRange (e.g. an
       LR8 crossover skirt well below the axis, or a big LT/shelf boost
       above it) -- clip to the plot rect so they never paint over the
       axis label margins instead of distorting the shape by clamping
       every point. -->
  <g clip-path="url(#{clipId})">
    {#if single && built[0]}
      <path
        d={built[0].d + ` L ${W} ${plotH} L ${PAD_L} ${plotH} Z`}
        fill="url(#bodeFill-{curves[0].id})"
        vector-effect="non-scaling-stroke"
      />
    {/if}

    {#each built as b (b.c.id)}
      <path
        d={b.d}
        fill="none"
        stroke={strokeFor(b.c)}
        stroke-width="1.6"
        stroke-linecap="round"
        vector-effect="non-scaling-stroke"
      />
    {/each}

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
  </g>

  {#each nodes as n (n.id)}
    {@const nx = nodeX(n)}
    {@const ny = nodeY(n)}
    {@const nc = nodeColor(n)}
    {@const r = n.selected ? 9 : 7}
    <g
      class="bode-node"
      class:dragging={dragId === n.id}
      role="slider"
      tabindex="0"
      aria-label={n.label ? `Band ${n.label}` : 'Band'}
      aria-valuemin={Eq.FREQ_MIN_HZ}
      aria-valuemax={Eq.FREQ_MAX_HZ}
      aria-valuenow={n.f}
      aria-valuetext={nodeAria(n)}
      onpointerdown={(e) => onNodeDown(e, n)}
      onpointermove={(e) => onNodeMove(e, n)}
      onpointerup={(e) => endDrag(e, n)}
      onpointercancel={(e) => endDrag(e, n)}
      onlostpointercapture={(e) => endDrag(e, n)}
      onwheel={(e) => onNodeWheelEvt(e, n)}
      oncontextmenu={(e) => onNodeCtx(e, n)}
      ondblclick={(e) => e.stopPropagation()}
      onkeydown={(e) => onNodeKey(e, n)}
      onkeyup={onNodeKeyUp}
      onblur={flushNudge}
    >
      {#if n.selected}
        {#if n.shape === 'diamond'}
          <rect
            x={nx - 9} y={ny - 9} width="18" height="18"
            transform={`rotate(45 ${nx} ${ny})`}
            fill="none" stroke={nc} stroke-opacity="0.4" stroke-width="2" pointer-events="none"
          />
        {:else}
          <circle cx={nx} cy={ny} r={r + 1} fill="none" stroke={nc} stroke-opacity="0.4" stroke-width="2" pointer-events="none" />
        {/if}
      {/if}
      {#if n.shape === 'diamond'}
        <rect
          x={nx - 6} y={ny - 6} width="12" height="12"
          transform={`rotate(45 ${nx} ${ny})`}
          fill={n.bypassed ? 'var(--bg)' : nc} stroke={nc} stroke-width="1.5"
        />
      {:else}
        <circle
          cx={nx} cy={ny} r={r}
          fill={n.bypassed ? 'var(--bg)' : nc} stroke={n.bypassed ? nc : 'var(--bg)'} stroke-width="1.5"
        />
      {/if}
      {#if n.label}
        <text
          x={nx} y={ny + 3} text-anchor="middle" font-size="9" font-family="var(--font-mono)"
          fill={n.bypassed ? nc : 'var(--bg)'} pointer-events="none"
        >
          {n.label}
        </text>
      {/if}
    </g>
  {/each}

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
  .bode-node {
    cursor: grab;
    outline: none;
  }
  .bode-node.dragging {
    cursor: grabbing;
  }
  .bode-node:focus-visible circle,
  .bode-node:focus-visible rect {
    stroke: var(--text);
  }
  .bode {
    display: block;
    touch-action: none;
    user-select: none;
  }
</style>
