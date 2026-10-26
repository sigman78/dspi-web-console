import { FilterType, Proc, type DspSnapshot } from '@/domain';
import type { DeviceFeatures } from '@/protocol/capabilities';
import type { ProgramModuleKey } from './programModel';
import { upmixStatus } from './upmixStatus';

export interface ChainBlock {
  key: ProgramModuleKey;
  title: string;
  /** null: the block has no enable switch. */
  enabled: boolean | null;
  values: string[];
}

export interface ChainTelemetry {
  activeInputChannels: number | null;
  sampleRateHz: number | null;
}

type ChainFeatures = Pick<DeviceFeatures, 'psybass' | 'subharm' | 'upmix' | 'limiter'>;

export function fmtSigned(db: number, digits = 1): string {
  const v = Math.abs(db).toFixed(digits);
  if (Number(v) === 0) return `+${v}`;
  return `${db < 0 ? '−' : '+'}${v}`;
}

/** Routes that reach sound: enabled, and their output is enabled. */
export function liveRouteCount(snap: DspSnapshot): number {
  const live = new Set(snap.outputs.filter((o) => o.enabled).map((o) => o.wireIndex));
  return snap.routes.filter((r) => r.enabled && live.has(r.outputWireIndex)).length;
}

const SPEED = ['slow', 'medium', 'fast'];
const PRESET = ['P1', 'P2', 'P3', 'Custom'];

const fmtBand = (db: number) => (db <= Proc.SUBHARM_LEVEL_MIN_DB ? 'Off' : fmtSigned(db));
const pct = (n: number) => `${Math.round(n)} %`;

export function chainBlocks(
  snap: DspSnapshot | null,
  features: ChainFeatures,
  telemetry?: ChainTelemetry,
): ChainBlock[] {
  if (!snap) return [];
  const off = (on: boolean, vals: string[]) => (on ? vals : ['off']);
  const preamps = snap.inputPreampDb;
  const inputs = snap.channels.filter((c) => !c.isOutput);
  const withBands = inputs.filter((c) => c.filters.some((f) => f.type !== FilterType.Flat)).length;
  const routes = liveRouteCount(snap);
  const outs = snap.outputs;
  const limOn = snap.limiter.filter((l, i) => l.enabled && outs.some((o) => o.wireIndex === i)).length;
  const { leveller: lv, crossfeed: cf, loudness: ld, psybass: pb, subharm: sh, upmix: up } = snap;
  const upStatus = upmixStatus(up.enabled, telemetry?.activeInputChannels ?? null, telemetry?.sampleRateHz ?? null);

  const blocks: ChainBlock[] = [
    {
      key: 'preamp',
      title: 'Preamp',
      enabled: null,
      values: [
        `${fmtSigned(snap.masterPreampDb)} dB`,
        ...(preamps.length && Math.min(...preamps) !== Math.max(...preamps)
          ? [`${fmtSigned(Math.min(...preamps))}/${fmtSigned(Math.max(...preamps))}`]
          : []),
      ],
    },
    {
      key: 'inputEq',
      title: 'Input EQ',
      enabled: null,
      values: [`${withBands} w/ bands`],
    },
    {
      key: 'leveller',
      title: 'Leveller',
      enabled: lv.enabled,
      values: off(lv.enabled, [SPEED[lv.speed] ?? String(lv.speed), pct(lv.amount)]),
    },
    {
      key: 'crossfeed',
      title: 'Crossfeed',
      enabled: cf.enabled,
      values: off(cf.enabled, [PRESET[cf.preset] ?? String(cf.preset), `${Math.round(cf.freq)} Hz`]),
    },
    {
      key: 'loudness',
      title: 'Loudness',
      enabled: ld.enabled,
      values: off(ld.enabled, [`${Math.round(ld.refSpl)} dB`, pct(ld.intensityPct)]),
    },
  ];
  if (features.psybass) {
    blocks.push({
      key: 'psybass',
      title: 'Psybass',
      enabled: pb.enabled,
      values: off(pb.enabled, [`${Math.round(pb.cutoffHz)} Hz`, `${fmtSigned(pb.harmonicsDb)} dB`]),
    });
  }
  if (features.subharm) {
    blocks.push({
      key: 'subharm',
      title: 'Subharm',
      enabled: sh.enabled,
      values: off(sh.enabled, [fmtBand(sh.lowDb), fmtBand(sh.highDb)]),
    });
  }
  if (features.upmix) {
    blocks.push({
      key: 'upmix',
      title: 'Upmix',
      enabled: up.enabled,
      values: up.enabled ? [upStatus === 'active' ? 'active' : 'parked', pct(up.strengthPct)] : ['off'],
    });
  }
  blocks.push(
    { key: 'matrix', title: 'Matrix', enabled: null, values: [`${routes} ${routes === 1 ? 'route' : 'routes'}`] },
    {
      key: 'outputStage',
      title: 'Output stage',
      enabled: null,
      values: [
        `${outs.filter((o) => o.enabled).length} on`,
        ...(outs.some((o) => o.muted) ? [`${outs.filter((o) => o.muted).length} muted`] : []),
        ...(features.limiter ? [`lim ${limOn}`] : []),
      ],
    },
  );
  return blocks;
}
