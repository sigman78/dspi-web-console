// Matrix-tab projections over DspSnapshot. Separate from mixer.ts so that
// stays snapshot-free (avoids a cycle with snapshot.ts).

import { ChannelId, slotForOutputChannel, type InputSlot, type OutputMode, type OutputSlot } from './channels';
import type { RouteModel } from './mixer';
import type { ChannelModel, DspSnapshot } from './snapshot';

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

export function channelById(s: DspSnapshot, id: ChannelId): ChannelModel | undefined {
  return s.channels.find((c) => c.id === id);
}

// Output mode is a projection of i2s.outputSlotTypes (one type per stereo
// pair); the PDM sub is fixed-mode. Throws on input channels -- they have
// no output mode and no caller should ask.
export function outputModeForChannel(s: DspSnapshot, id: ChannelId): OutputMode {
  if (id === ChannelId.Pdm) return 'PDM';
  const slot = slotForOutputChannel(id);
  if (slot === null) throw new Error(`Channel ${id} has no output mode`);
  return s.i2s.outputSlotTypes[slot] === 1 ? 'I2S' : 'SPDIF';
}

export function matrixColumns(snapshot: DspSnapshot | null): MatrixColumn[] {
  if (!snapshot) return [];
  return snapshot.outputs.map((output) => ({
    id: output.id,
    wireIdx: output.wireIndex,
    shortName: output.shortName,
    name: channelById(snapshot, output.id)?.name ?? '',
    outputMode: outputModeForChannel(snapshot, output.id),
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
    label: channelById(snapshot, inputIds[idx])?.name ?? '',
    cells,
  }));
}
