// Matrix-tab projections: shape the snapshot into per-column / per-row
// structures the matrix UI renders. Pure functions over DspSnapshot.
//
// Lives separately from mixer.ts so mixer.ts can stay a pure leaf of
// type definitions — no DspSnapshot import, no cycle with snapshot.ts.

import { ChannelId, type InputSlot, type OutputMode, type OutputSlot } from './channels';
import type { RouteModel } from './mixer';
import type { DspSnapshot } from './snapshot';

export interface MatrixColumn {
  id: ChannelId;
  wireIdx: OutputSlot;
  shortName: string;
  name: string;
  outputMode: OutputMode;
  enabled: boolean;
  muted: boolean;
  gainDb: number;
  delayMs: number;
}

export interface MatrixRow {
  inputIndex: InputSlot;
  inputId: ChannelId;
  label: string;
  cells: RouteModel[];
}

export function matrixColumns(snapshot: DspSnapshot | null): MatrixColumn[] {
  if (!snapshot) return [];
  return snapshot.outputs.map((output) => ({
    id: output.id,
    wireIdx: output.wireIndex,
    shortName: output.shortName,
    name: output.name,
    outputMode: output.outputMode,
    enabled: output.enabled,
    muted: output.muted,
    gainDb: output.gainDb,
    delayMs: output.delayMs,
  }));
}

export function matrixRows(snapshot: DspSnapshot | null): MatrixRow[] {
  if (!snapshot) return [];
  const inputIds: ChannelId[] = [ChannelId.In1L, ChannelId.In1R];
  const byInput: RouteModel[][] = [[], []];
  for (const r of snapshot.routes) byInput[r.inputIndex].push(r);
  return byInput.map((cells, idx) => ({
    inputIndex: idx as InputSlot,
    inputId: inputIds[idx],
    label: cells[0]?.inputName ?? '',
    cells,
  }));
}
