// Wire-protocol monitor (Level 1): pure formatters that turn one wire
// message into a terse single-line string for the browser console. Enabled
// via `?debug`; consumed by the withWireMonitor transport decorator. The
// command table is the existing WireCmd; we derive a code ->{name, codec}
// reverse map so nothing is duplicated. All decoding is best-effort and
// guarded — a decode failure degrades to a name + byte-count line.

import { Codec, type BinCodec } from '@/utils';
import { WireCmd } from './wireCmd';
import type { BulkLayout } from './wireTypes';
import { parseNotifyPacket, ParamSource } from './notify';

// Turn on only when the page URL carries `?debug`. Read at call time so the
// gate is testable and reflects the live URL; it is consulted once at boot.
export function wireMonitorEnabled(): boolean {
  if (typeof location === 'undefined') return false;
  return new URLSearchParams(location.search).get('debug') !== null;
}

// Bulk transfers carry the whole param block; we render version + size only.
const BULK_READ = WireCmd.GetAllParams.code;   // 0xA0
const BULK_WRITE = WireCmd.SetAllParams.code;  // 0xA1

interface CmdInfo {
  name: string;
  codec?: BinCodec<unknown>;
}

// code ->{name, codec?} derived from the single WireCmd source of truth.
const CMD_BY_CODE = new Map<number, CmdInfo>();
for (const [name, entry] of Object.entries(WireCmd)) {
  const codec = 'codec' in entry ? (entry.codec as BinCodec<unknown>) : undefined;
  CMD_BY_CODE.set(entry.code, { name, codec });
}

// ParamSource value -> lowercase name (host, gpio, ...) for notification lines.
const SOURCE_NAME = new Map<number, string>(
  Object.entries(ParamSource).map(([k, v]) => [v, k.toLowerCase()] as [number, string]),
);

function fmtScalar(v: unknown): string {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'string') return JSON.stringify(v.length > 24 ? `${v.slice(0, 24)}...` : v);
  return String(v);
}

// Scalars print bare; objects print their fields inline (`k=v k=v`).
function fmtValue(v: unknown): string {
  if (v !== null && typeof v === 'object') {
    return Object.entries(v).map(([k, val]) => `${k}=${fmtScalar(val)}`).join(' ');
  }
  return fmtScalar(v);
}

function fmtWValue(value: number): string {
  return value !== 0 ? ` w=0x${value.toString(16)}` : '';
}

// Best-effort decode of a fixed-size codec; on failure (or no codec) fall
// back to a byte-count tail so the line is always useful.
function decodeOrSize(info: CmdInfo | undefined, bytes: Uint8Array): string {
  if (info?.codec) {
    try {
      return fmtValue(Codec.decodePadded(info.codec, bytes));
    } catch {
      // fall through to size
    }
  }
  return `${bytes.length} B`;
}

export function formatCtrlOut(request: number, value: number, data: Uint8Array): string {
  if (request === BULK_WRITE) {
    return `<> SetAllParams (bulk) v${data[0] ?? 0} ${data.length} B`;
  }
  const info = CMD_BY_CODE.get(request);
  const name = info ? info.name : `0x${request.toString(16)}`;
  return `-> ${name}${fmtWValue(value)} ${decodeOrSize(info, data)}`;
}

export function formatCtrlIn(request: number, value: number, bytes: Uint8Array): string {
  if (request === BULK_READ) {
    return `<> GetAllParams (bulk) v${bytes[0] ?? 0} ${bytes.length} B`;
  }
  const info = CMD_BY_CODE.get(request);
  const name = info ? info.name : `0x${request.toString(16)}`;
  return `<- ${name}${fmtWValue(value)} ${decodeOrSize(info, bytes)}`;
}

function srcName(source: number): string {
  return SOURCE_NAME.get(source) ?? `src${source}`;
}

// Returns null for idle keep-alives (suppressed to avoid console spam).
export function formatNotify(bytes: Uint8Array): string | null {
  const e = parseNotifyPacket(bytes);
  switch (e.kind) {
    case 'idle':
      return null;
    case 'paramChanged':
      return `<~ notify paramChanged seq=${e.seq} src=${srcName(e.source)}`;
    case 'bulkInvalidated':
      return `<~ notify bulkInvalidated seq=${e.seq} src=${srcName(e.source)}`;
    case 'presetLoaded':
      return `<~ notify presetLoaded seq=${e.seq} slot=${e.slot}`;
    default:
      return '<~ notify (ignored)';
  }
}

// Structural subset of the device's connection info needed for the banner.
// Kept structural (not an import of DspDeviceInfo) so this protocol-layer module
// doesn't depend on the device layer; `device.info` satisfies it as-is.
interface DeviceInfoLike {
  readonly serial: string;
  readonly hardware: {
    readonly name: string;
    readonly outputCount: number;
    readonly totalChannelCount: number;
  };
  readonly capabilities: {
    readonly platformId: number;
    readonly fwLabel: string;
    readonly wireLabel: string;
    readonly support: string;
    readonly sections: BulkLayout;
    readonly features: { readonly notifications: boolean };
  };
}

// Multi-line connection banner, logged once at connect (info level) so a debug
// session is self-documenting: which device, firmware/wire, and what its bulk
// packet carries.
export function formatDeviceInfo(info: DeviceInfoLike): string[] {
  const c = info.capabilities;
  const sections = Object.entries(c.sections)
    .filter(([, present]) => present)
    .map(([name]) => name)
    .join(',') || 'none';
  return [
    `* device connected - ${info.hardware.name} (platformId ${c.platformId})`,
    `  firmware ${c.fwLabel} | wire ${c.wireLabel} (${c.support})`,
    `  serial "${info.serial}" | ${info.hardware.totalChannelCount} ch / ${info.hardware.outputCount} out`,
    `  sections ${sections} | notify ${c.features.notifications ? 'on' : 'off'}`,
  ];
}

// Commands the runtime polls continuously for telemetry: GetStatus (peaks + env
// scalars + error counters) and GetBufferStats (DMA/ring fill). These would bury
// the interesting traffic, so the decorator logs them at debug (Verbose) level —
// hidden by default in DevTools, one filter click away — while everything else
// stays at info.
const POLL_CODES = new Set<number>([WireCmd.GetStatus.code, WireCmd.GetBufferStats.code]);

export function isPollCommand(request: number): boolean {
  return POLL_CODES.has(request);
}
