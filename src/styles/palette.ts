import { ChannelId } from '@/domain';

export type ChannelKey =
  | 'In1L' | 'In1R'
  | 'Out1L' | 'Out1R' | 'Out2L' | 'Out2R'
  | 'Out3L' | 'Out3R' | 'Out4L' | 'Out4R'
  | 'Pdm'
  | 'In2L' | 'In2R' | 'In3L' | 'In3R' | 'In4L' | 'In4R';

export type ShadeName = 'base' | 'bright' | 'dim' | 'glow';

type Lch = { l: number; c: number; h: number };

const COLORS: Record<ChannelKey, Lch> = {
  In1L:  { l: 73, c: 0.115, h: 210 },
  In1R:  { l: 67, c: 0.135, h: 230 },
  Out1L: { l: 73, c: 0.125, h: 145 },
  Out1R: { l: 67, c: 0.150, h: 165 },
  Out2L: { l: 73, c: 0.115, h: 275 },
  Out2R: { l: 67, c: 0.135, h: 295 },
  Out3L: { l: 74, c: 0.135, h:  65 },
  Out3R: { l: 68, c: 0.155, h:  85 },
  Out4L: { l: 73, c: 0.115, h:   5 },
  Out4R: { l: 67, c: 0.135, h:  25 },
  Pdm:   { l: 70, c: 0.010, h: 250 },
  // Extra input pairs (V16 multichannel input). Cool hues distinct from the
  // In1 blues and clear of the output families.
  In2L:  { l: 73, c: 0.115, h: 190 },
  In2R:  { l: 67, c: 0.135, h: 200 },
  In3L:  { l: 73, c: 0.115, h: 320 },
  In3R:  { l: 67, c: 0.135, h: 335 },
  In4L:  { l: 73, c: 0.115, h: 105 },
  In4R:  { l: 67, c: 0.135, h: 120 },
};

const clampL = (v: number) => Math.max(0, Math.min(100, v));
const clampC = (v: number) => Math.max(0, Math.min(0.4, v));
const fmt = (l: number, c: number, h: number) =>
  `oklch(${clampL(l)}% ${clampC(c).toFixed(3)} ${h})`;

const SHADE_FORMULAS: Record<ShadeName, (lch: Lch) => string> = {
  base:   ({ l, c, h }) => fmt(l,      c,        h),
  bright: ({ l, c, h }) => fmt(l - 10, c * 2.4,  h),
  dim:    ({ l, c, h }) => fmt(l - 20, c * 0.5,  h),
  glow:   ({ l, c, h }) => fmt(l - 4,  c * 2.6,  h),
};

const KEY_BY_ID: Record<number, ChannelKey> = {
  [ChannelId.In1L]: 'In1L',
  [ChannelId.In1R]: 'In1R',
  [ChannelId.Out1L]: 'Out1L',
  [ChannelId.Out1R]: 'Out1R',
  [ChannelId.Out2L]: 'Out2L',
  [ChannelId.Out2R]: 'Out2R',
  [ChannelId.Out3L]: 'Out3L',
  [ChannelId.Out3R]: 'Out3R',
  [ChannelId.Out4L]: 'Out4L',
  [ChannelId.Out4R]: 'Out4R',
  [ChannelId.Pdm]: 'Pdm',
  [ChannelId.In2L]: 'In2L',
  [ChannelId.In2R]: 'In2R',
  [ChannelId.In3L]: 'In3L',
  [ChannelId.In3R]: 'In3R',
  [ChannelId.In4L]: 'In4L',
  [ChannelId.In4R]: 'In4R',
};

export function chKey(id: ChannelId): ChannelKey {
  const key = KEY_BY_ID[id];
  if (!key) throw new Error(`Unknown ChannelId: ${id}`);
  return key;
}

function shadeFor(color: Lch, shade: ShadeName): string {
  return SHADE_FORMULAS[shade](color);
}

export function chShade(id: ChannelId, shade: ShadeName = 'base'): string {
  return shadeFor(COLORS[chKey(id)], shade);
}

export function paletteCSS(): string {
  return (Object.keys(COLORS) as ChannelKey[])
    .map((key) => {
      const c = COLORS[key];
      return `.ch-${key} {
  --ch-base:   ${shadeFor(c, 'base')};
  --ch-bright: ${shadeFor(c, 'bright')};
  --ch-dim:    ${shadeFor(c, 'dim')};
  --ch-glow:   ${shadeFor(c, 'glow')};
}`;
    })
    .join('\n');
}
