// Mixer matrix shapes: per-cell crosspoint, per-output trim, and the
// enriched app-model wrappers (RouteModel, OutputModel). Pure type
// definitions — no snapshot dependency, no cycle with snapshot.ts.
//
// Matrix-tab projections (matrixColumns, matrixRows) live in mixerView.ts.

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
  outputWireIndex: OutputSlot;
  outputName: string;
}

export interface OutputModel extends OutputState {
  id: ChannelId;
  wireIndex: OutputSlot;
  name: string;
  shortName: string;
  outputMode: OutputMode;
}
