// Selectable output latency (REQ_OUTPUT_LATENCY). Ids are the wire and flash
// values; 0 is never valid.

export const OUTPUT_LATENCY_DEFAULT_ID = 5;

export interface OutputLatencyStatus {
  requestedId: number;
  effectiveId: number;
  effectiveUs: number;
  targetFrames: number;
  batchFrames: number;
  pending: boolean;
  optionCount: number;
}

export interface OutputLatencyOption {
  id: number;
  latencyUs: number;
  batchUs: number;
  // What selecting this option gives now (active source and rate applied).
  effectiveUs: number;
  // Needs a stream input (S/PDIF, I2S, ADAT); runs as the 2 ms option on USB.
  streamOnly: boolean;
  // Runs as itself on the active source.
  available: boolean;
}

// Ring health counters (REQ_GET_STATUS 26-31); null when a read failed.
export interface RingHealth {
  underrunEpisodes: number | null;
  blocksRefused: number | null;
  lowestFillFrames: number | null;
  inputGapWorstUs: number | null;
  usbPacketGapWorstUs: number | null;
  backgroundOverBudget: number | null;
}

// "0.67 ms", "4 ms".
export function formatLatencyMs(us: number): string {
  return `${Number((us / 1000).toFixed(2))} ms`;
}
