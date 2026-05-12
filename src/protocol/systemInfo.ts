// Slow-poll telemetry types (REQ_GET_STATUS dispatch by wValue).
// See docs/system-status-req.md and ./wireTypes.ts SystemStatusValue.
//
// All fields are converted to display units in DspDevice.getSystemInfo;
// raw firmware units (mV, centi-degC, Hz) are kept for round-trip fidelity.
//
// No parser file: each field is read with `decodePadded(Codec.u32|i32, buf)`
// directly inside DspDevice.getSystemInfo — there is no SystemInfo-shaped
// wire packet, only a stream of single-scalar reads.

export interface SystemInfo {
  // Environment
  clockHz: number;
  coreVoltageMv: number;        // millivolts as reported by firmware
  sampleRateHz: number;
  tempCDegC: number;            // centi-degrees Celsius (raw)

  // Error counters (u32, monotonically increasing)
  pdmRingOverruns: number;
  pdmRingUnderruns: number;
  pdmDmaOverruns: number;
  pdmDmaUnderruns: number;
  spdifOverruns: number;
  spdifUnderruns: number;
  spdifStarvationsTotal: number;
}

// Result of one slow-poll cycle. Fields are `null` when this poll's
// individual ctrlIn rejected (firmware doesn't support the wValue, USB
// hiccup, etc.). The applyPartialInfo helper in telemetry.svelte.ts folds
// non-null fields into the store; null fields keep their previous value.
export type PartialSystemInfo = { [K in keyof SystemInfo]: number | null };
