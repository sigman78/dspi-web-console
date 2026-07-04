import { SvelteSet } from 'svelte/reactivity';
import { ChannelId, type ChannelModel } from '@/domain';
import type { BodeCurve } from './BodePlot.svelte';
import { filterCurve } from './filterCurve';

// Pairs whose two curves merge into one line when both sides share EQ state.
const STEREO_PAIRS: ReadonlyArray<readonly [ChannelId, ChannelId]> = [
  [ChannelId.In1L, ChannelId.In1R],
  [ChannelId.Out1L, ChannelId.Out1R],
  [ChannelId.Out2L, ChannelId.Out2R],
  [ChannelId.Out3L, ChannelId.Out3R],
  [ChannelId.Out4L, ChannelId.Out4R],
];

function curvesEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const eps = 1e-9;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > eps) return false;
  }
  return true;
}

// Merges each stereo pair (STEREO_PAIRS) that shares identical EQ state into
// one gradient-stroked curve, splits pairs that diverge into two, and passes
// singletons (PDM, or a lone half of a pair) through unchanged.
export function overviewCurves(
  activeChannels: readonly ChannelModel[],
  preampOffsetFor: (c: ChannelModel) => number,
): BodeCurve[] {
  const out: BodeCurve[] = [];
  const consumed = new SvelteSet<ChannelId>();
  const byId = new Map(activeChannels.map((c) => [c.id, c]));

  for (const [lId, rId] of STEREO_PAIRS) {
    const l = byId.get(lId), r = byId.get(rId);
    if (!l || !r) continue;
    consumed.add(lId);
    consumed.add(rId);
    const ptsL = filterCurve(l.filters, preampOffsetFor(l));
    const ptsR = filterCurve(r.filters, preampOffsetFor(r));
    if (curvesEqual(ptsL, ptsR)) {
      // Stroke fades L -> R across the plot to signal a shared response.
      out.push({
        id: `ov-${l.id}-${r.id}`,
        label: `${l.shortName}/${r.shortName}`,
        gradientChannelIds: [l.id, r.id],
        points: ptsL,
      });
    } else {
      out.push({ id: `ov-${l.id}`, channelId: l.id, label: l.shortName, points: ptsL });
      out.push({ id: `ov-${r.id}`, channelId: r.id, label: r.shortName, points: ptsR });
    }
  }
  // Singletons (e.g. PDM, or one half of a pair if the other isn't active).
  for (const c of activeChannels) {
    if (consumed.has(c.id)) continue;
    out.push({
      id: `ov-${c.id}`, channelId: c.id, label: c.shortName,
      points: filterCurve(c.filters, preampOffsetFor(c)),
    });
  }
  return out;
}
