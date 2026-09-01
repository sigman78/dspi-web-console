// Wire-protocol monitor: formatters that turn one wire message into a terse
// single-line string for the browser console. Enabled via `?log=wire`, consumed
// by the withWireMonitor transport decorator. Decoding is best-effort: a
// failure degrades to a name + byte-count line.

import { Codec, type BinCodec } from '@/utils';
import { WireCmd } from './wireCmd';
import * as Wire from './wireTypes';
import type { BulkLayout } from './wireTypes';
import { parseNotifyPacket, ParamSource, type ParamChangedEvent } from './notify';
import { describeBulkOffset } from './bulkOffsets';
import { wireLogEnabled } from '@/devOptions';

// Read at call time so the gate is testable and reflects the live URL.
export function wireMonitorEnabled(): boolean {
  return wireLogEnabled();
}

// Bulk transfers carry the whole param block; we render version + size only.
const BULK_READ = WireCmd.GetAllParams.code;   // 0xA0
const BULK_WRITE = WireCmd.SetAllParams.code;  // 0xA1
// Chunked bulk access (fw 1.1.5+): wValue is the byte offset, worth showing.
const BULK_READ_CHUNK = WireCmd.GetAllParamsChunk.code;   // 0xA2
const BULK_WRITE_CHUNK = WireCmd.SetAllParamsChunk.code;  // 0xA3

// Derives the bulk wire version from control traffic that carries the
// header's first byte (formatVersion): a full bulk transfer always does, and
// a chunked transfer only at chunk offset 0. Lets withWireMonitor track the
// device's wire version so it can enrich later PARAM_CHANGED notifications.
export function bulkVersionFromTraffic(request: number, value: number, payload: Uint8Array): number | null {
  if (payload.length === 0) return null;
  if (request === BULK_READ || request === BULK_WRITE) return payload[0];
  if ((request === BULK_READ_CHUNK || request === BULK_WRITE_CHUNK) && value === 0) return payload[0];
  return null;
}

interface CmdInfo {
  name: string;
  codec?: BinCodec<unknown>;
}

// code ->{name, codec?} reverse map derived from WireCmd.
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
  if (request === BULK_WRITE_CHUNK) {
    return `<> SetAllParamsChunk @${value} ${data.length} B`;
  }
  const info = CMD_BY_CODE.get(request);
  const name = info ? info.name : `0x${request.toString(16)}`;
  return `-> ${name}${fmtWValue(value)} ${decodeOrSize(info, data)}`;
}

export function formatCtrlIn(request: number, value: number, bytes: Uint8Array): string {
  if (request === BULK_READ) {
    return `<> GetAllParams (bulk) v${bytes[0] ?? 0} ${bytes.length} B`;
  }
  if (request === BULK_READ_CHUNK) {
    return `<> GetAllParamsChunk @${value} ${bytes.length} B`;
  }
  const info = CMD_BY_CODE.get(request);
  const name = info ? info.name : `0x${request.toString(16)}`;
  return `<- ${name}${fmtWValue(value)} ${decodeOrSize(info, bytes)}`;
}

function srcName(source: number): string {
  return SOURCE_NAME.get(source) ?? `src${source}`;
}

function hexPreview(bytes: Uint8Array, max = 16): string {
  return Array.from(bytes.subarray(0, max), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Appends what a PARAM_CHANGED splice actually touched, when the field can be
// resolved: the exact field for an exact-size write, the whole band for a
// firmware EQ write (bands are always spliced whole), or a path+delta for
// anything coarser. Falls back to a byte-count + hex tail when the version is
// unknown or the splice can't be resolved -- never throws.
function formatParamChangedTail(e: ParamChangedEvent, bulkVersion: number | null): string {
  const base = ` off=${e.offset}`;
  try {
    if (bulkVersion !== null) {
      const hit = describeBulkOffset(e.offset, bulkVersion);
      if (hit) {
        if (hit.leaf && e.offset === hit.leafOffset && e.size === Codec.sizeOf(hit.leaf)) {
          return `${base} ${hit.path}=${fmtValue(Codec.decode(hit.leaf, e.value))}`;
        }
        if (e.size === 16 && e.offset === hit.leafOffset && hit.path.endsWith('.type')) {
          const bandCodec = bulkVersion >= 22 ? Wire.BandParamsQp : Wire.BandParams;
          const decoded = Codec.decode(bandCodec, e.value);
          const bandPath = hit.path.slice(0, hit.path.lastIndexOf('.'));
          return `${base} ${bandPath} ${fmtValue(decoded)}`;
        }
        return hit.leaf ? `${base} ${hit.path}+${e.offset - hit.leafOffset}` : `${base} ${hit.path}`;
      }
    }
  } catch {
    // fall through to the byte-count fallback
  }
  return `${base} ${e.size}B ${hexPreview(e.value)}`;
}

// Returns null for idle keep-alives (suppressed to avoid console spam).
// `bulkVersion` enriches paramChanged with the field it wrote, when known.
export function formatNotify(bytes: Uint8Array, bulkVersion: number | null = null): string | null {
  const e = parseNotifyPacket(bytes);
  switch (e.kind) {
    case 'idle':
      return null;
    case 'paramChanged':
      return `<~ notify paramChanged seq=${e.seq} src=${srcName(e.source)}${formatParamChangedTail(e, bulkVersion)}`;
    case 'bulkInvalidated':
      return `<~ notify bulkInvalidated seq=${e.seq} src=${srcName(e.source)}`;
    case 'presetLoaded':
      return `<~ notify presetLoaded seq=${e.seq} slot=${e.slot}`;
    default:
      return '<~ notify (ignored)';
  }
}

// Structural (not an import of DspDeviceInfo) so this protocol-layer module
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
  };
}

// Multi-line connection banner logged once at connect, so a debug session is
// self-documenting: which device, firmware/wire, and what its bulk packet carries.
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
    `  sections ${sections}`,
  ];
}

// Telemetry commands polled continuously; logged at debug level so they don't
// bury the interesting traffic (everything else stays at info).
const POLL_CODES = new Set<number>([WireCmd.GetStatus.code, WireCmd.GetBufferStats.code]);

export function isPollCommand(request: number): boolean {
  return POLL_CODES.has(request);
}

// Rolling capture of every logged wire line, for a tester to pull out of a
// live session (`copy(__dspiWireLog.join('\n'))` in DevTools) without having
// scrolled the console the whole time. Capped so a long session can't leak
// memory.
const MAX_CAPTURED_LINES = 2000;
const capturedLines: string[] = [];
let published = false;

export function recordWireLine(line: string): void {
  const prefix = typeof performance === 'undefined' ? '' : `[+${(performance.now() / 1000).toFixed(3)}s] `;
  capturedLines.push(`${prefix}${line}`);
  if (capturedLines.length > MAX_CAPTURED_LINES) capturedLines.shift();
  if (!published) {
    published = true;
    (globalThis as Record<string, unknown>).__dspiWireLog = capturedLines;
  }
}
