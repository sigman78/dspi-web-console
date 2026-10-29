// Onboard real-time analyser (RTA) domain types and pure helpers. Band levels
// arrive as u8 counts; `levelZero` (from the device caps) is the count that
// means 0 dBFS and counts step in 0.5 dB.

export const RtaTap = { Input: 0, Output: 1 } as const;
export type RtaTap = (typeof RtaTap)[keyof typeof RtaTap];

export const RtaState = { Idle: 0, Capturing: 1, Transforming: 2 } as const;

export const RTA_CONFIG_VERSION = 3;
export const RTA_AVG_MS = 100;
export const RTA_LEVEL_STEP_DB = 0.5;
/** A frame older than this (or never produced) counts as silence. */
export const RTA_FRAME_FRESH_MS = 1000;

export interface RtaCaps {
  version: number;
  inputChannels: number;
  outputChannels: number;
  fftOrderMin: number;
  fftOrderMax: number;
  fftOrderDefault: number;
  bassBands: number;
  maxBands: number;
  levelZero: number;
  dynamicRangeDb: number;
  idleTimeoutMs: number;
  maxBinFrame: number;
  bassDynamicRangeDb: number;
}

export interface RtaConfig {
  tap: number;
  channelMask: number;
  fftOrder: number;
  avgMs: number;
  peakDecayDbS: number;
  flags: number;
}

export interface RtaStatus {
  state: number;
  tap: number;
  /** 0xFF = none. */
  channel: number;
  liveCount: number;
  liveMask: number;
  framesPerS: number;
  busyUsPerS: number;
  lastFrameUs: number;
  /** 0xFFFF = never read. */
  idleMs: number;
  sampleRateHz: number;
  firstBand: number;
  bassBusyUsPerS: number;
}

/** One channel's band frame as read from the device (raw level counts). */
export interface RtaBandFrameRaw {
  version: number;
  /** Wire channel at the configured tap (an output index at the output tap). */
  channel: number;
  seq: number;
  /** null = the device has never produced a frame for this channel. */
  ageMs: number | null;
  /** Average level counts, one per valid band. */
  avg: number[];
}

/** A decoded frame: average levels in dBFS (-Infinity = floor, also for stale frames). */
export interface RtaFrame {
  channel: number;
  seq: number;
  ageMs: number | null;
  levelsDb: number[];
}

export function rtaLevelDb(count: number, levelZero: number): number {
  return count <= 0 ? -Infinity : (count - levelZero) * RTA_LEVEL_STEP_DB;
}

/** The firmware only fills frames while audio flows, so silence leaves them unproduced. */
export function rtaFrameFresh(ageMs: number | null): boolean {
  return ageMs !== null && ageMs <= RTA_FRAME_FRESH_MS;
}

export function rtaDecodeFrame(raw: RtaBandFrameRaw, caps: Pick<RtaCaps, 'levelZero'>): RtaFrame {
  return {
    channel: raw.channel,
    seq: raw.seq,
    ageMs: raw.ageMs,
    levelsDb: raw.avg.map((v) => (rtaFrameFresh(raw.ageMs) ? rtaLevelDb(v, caps.levelZero) : -Infinity)),
  };
}

/** Our analyser setup: every output at the output tap. */
export function rtaWantedConfig(caps: RtaCaps, outputCount: number): RtaConfig {
  return {
    tap: RtaTap.Output,
    channelMask: (1 << outputCount) - 1,
    fftOrder: caps.fftOrderDefault,
    avgMs: RTA_AVG_MS,
    peakDecayDbS: 0,
    flags: 0,
  };
}

/**
 * Shared-analyser rule: if the device already measures the output tap with
 * every output we want, adopt it (null = push nothing). Otherwise push our
 * config, widening the mask with the device's when it is also on the output
 * tap so another host's channels keep being measured.
 */
export function rtaPlanConfig(applied: RtaConfig, wanted: RtaConfig): RtaConfig | null {
  const onOutputTap = applied.tap === RtaTap.Output;
  if (onOutputTap && (applied.channelMask & wanted.channelMask) === wanted.channelMask) return null;
  return onOutputTap ? { ...wanted, channelMask: wanted.channelMask | applied.channelMask } : wanted;
}
