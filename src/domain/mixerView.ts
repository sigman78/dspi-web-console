// Snapshot joins and matrix-tab projections over DspSnapshot. Separate from mixer.ts so that
// stays snapshot-free (avoids a cycle with snapshot.ts).

import { ChannelId, OutputSlotType, inputIndexOf, slotForOutputChannel, type InputSlot, type OutputMode, type OutputSlot } from './channels';
import type { RouteModel } from './mixer';
import { UpmixSurroundMode } from './processing';
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

function channelById(s: DspSnapshot, id: ChannelId): ChannelModel | undefined {
  return s.channels.find((c) => c.id === id);
}

// Output mode is a projection of i2s.outputSlotTypes (one type per stereo
// pair); the PDM sub is fixed-mode. Throws on input channels -- they have
// no output mode and no caller should ask.
function outputModeForChannel(s: DspSnapshot, id: ChannelId): OutputMode {
  if (id === ChannelId.Pdm) return 'PDM';
  const slot = slotForOutputChannel(id);
  if (slot === null) throw new Error(`Channel ${id} has no output mode`);
  return s.i2s.outputSlotTypes[slot] === OutputSlotType.I2s ? 'I2S' : 'SPDIF';
}

// Disabled outputs are hidden entirely -- the mixer only shows what can
// actually carry signal (SYSTEM > OUTPUTS is where enable/disable lives).
export function matrixColumns(snapshot: DspSnapshot | null): MatrixColumn[] {
  if (!snapshot) return [];
  return snapshot.outputs.filter((o) => o.enabled).map((output) => ({
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

// Upmix context for matrixRows' label override: when the upmixer is enabled
// and the live input is a plain stereo pair, it repurposes the otherwise-idle
// input slots 2-4 (In2L/In2R/In3L) as derived-channel busses so their audio
// can be routed through the same crosspoint matrix as a real input would be.
export interface UpmixRowContext {
  enabled: boolean;
  surroundMode: number;
}

// One row per hardware input channel (2 on V10, up to 8 on V16 RP2350).
// activeInputs limits the rows to the LIVE input count (USB alt / I2S channel
// count); null/undefined shows every hardware input. When upmix is active
// over a stereo pair, the row count is bumped so its derived-channel rows
// (hidden by activeInputs otherwise, being silent on a plain stereo source)
// stay visible for routing.
export function matrixRows(
  snapshot: DspSnapshot | null,
  activeInputs?: number | null,
  upmix?: UpmixRowContext | null,
): MatrixRow[] {
  if (!snapshot) return [];
  const inputs = snapshot.channels
    .filter((c) => !c.isOutput)
    .sort((a, b) => (inputIndexOf(a.id) ?? 0) - (inputIndexOf(b.id) ?? 0));
  const isStereoInput = activeInputs === 2;
  const upmixActive = upmix?.enabled === true && isStereoInput;
  const surroundActive = upmixActive && upmix!.surroundMode !== UpmixSurroundMode.Off;
  const upmixRowFloor = upmixActive ? (surroundActive ? 5 : 3) : 0;
  const shown = activeInputs != null
    ? inputs.slice(0, Math.max(1, activeInputs, upmixRowFloor))
    : inputs;
  // Column position of each enabled output, so a row's cells can be filtered
  // and ordered to line up with matrixColumns() rather than trusting the
  // route list's own order.
  const columnOrder = new Map(snapshot.outputs.filter((o) => o.enabled).map((o, i) => [o.wireIndex, i]));
  const byInput = new Map<number, RouteModel[]>();
  for (const r of snapshot.routes) {
    if (!columnOrder.has(r.outputWireIndex)) continue;
    const cells = byInput.get(r.inputIndex);
    if (cells) cells.push(r);
    else byInput.set(r.inputIndex, [r]);
  }
  for (const cells of byInput.values()) {
    cells.sort((a, b) => columnOrder.get(a.outputWireIndex)! - columnOrder.get(b.outputWireIndex)!);
  }
  return shown.map((ch) => {
    const idx = (inputIndexOf(ch.id) ?? 0) as InputSlot;
    let label = ch.name;
    if (upmixActive) {
      if (idx === 2) label = 'Upmix C';
      else if (idx === 3 && surroundActive) label = 'Upmix Ls';
      else if (idx === 4 && surroundActive) label = 'Upmix Rs';
    }
    return {
      inputIndex: idx,
      inputId: ch.id,
      label,
      cells: byInput.get(idx) ?? [],
    };
  });
}
