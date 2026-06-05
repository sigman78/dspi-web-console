// Mixer matrix type definitions: crosspoint, output trim, and the enriched
// app-model wrappers. Snapshot-free to avoid a cycle with snapshot.ts.

import type { ChannelId, InputSlot, OutputSlot, OutputMode } from './channels';

// Wire-shape feature types (also referenced by BulkParams in protocol/).
export interface CrossPoint {
  enabled: boolean;
  invert: boolean;
  gainDb: number;
}

export interface OutputState {
  enabled: boolean;
  muted: boolean;
  gainDb: number;
  delayMs: number;
}

// Enriched app-model wrappers.
export interface RouteModel extends CrossPoint {
  inputIndex: InputSlot;
  inputName: string;
  outputId: ChannelId;
  // Protocol matrix/output slot. Platform-compact: RP2040 PDM is 4,
  // RP2350 PDM is 8.
  outputWireIndex: OutputSlot;
  outputName: string;
}

export interface OutputModel extends OutputState {
  id: ChannelId;
  // Protocol matrix/output slot. Platform-compact: RP2040 PDM is 4,
  // RP2350 PDM is 8.
  wireIndex: OutputSlot;
  name: string;
  shortName: string;
  outputMode: OutputMode;
}
