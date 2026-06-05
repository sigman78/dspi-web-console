// Slow-poll telemetry types (REQ_GET_STATUS dispatch by wValue).
// Raw firmware units (mV, centi-degC, Hz) are kept for round-trip fidelity;
// conversion to display units happens in DspDevice.getSystemInfo.

export interface SystemInfo {
  clockHz: number;
  coreVoltageMv: number;        // millivolts as reported by firmware
  sampleRateHz: number;
  tempCDegC: number;            // centi-degrees Celsius (raw)

  // u32, monotonically increasing
  pdmRingOverruns: number;
  pdmRingUnderruns: number;
  pdmDmaOverruns: number;
  pdmDmaUnderruns: number;
  spdifOverruns: number;
  spdifUnderruns: number;
  spdifStarvationsTotal: number;
}

// Result of one slow-poll cycle. A field is `null` when that wValue's ctrlIn
// rejected (unsupported, USB hiccup); consumers keep the previous value.
export type PartialSystemInfo = { [K in keyof SystemInfo]: number | null };
