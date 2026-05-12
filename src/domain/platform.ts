// Hardware platform identity, descriptor, and output transport configuration.
//
// PlatformType is the firmware-pinned identity byte (RP2040=0, RP2350=1).
// PlatformInfo is the descriptor derived from PlatformType (channel counts,
// PDM index, display name).
// I2sConfig is the per-platform output transport configuration (I2S vs SPDIF
// per slot, pin assignments) — mutable per session, but conceptually a
// "what is this physical platform doing" property.

export const PlatformType = {
  RP2040: 0,
  RP2350: 1,
} as const;
export type PlatformType = (typeof PlatformType)[keyof typeof PlatformType];

export interface PlatformInfo {
  type: PlatformType;
  name: string;
  outputCount: number;
  totalChannelCount: number;
  pdmOutputIndex: number;
}

export interface I2sConfig {
  outputSlotTypes: [number, number, number, number];
  bckPin: number;
  mckPin: number;
  mckEnabled: boolean;
  mckMultiplierEncoded: number;
}
