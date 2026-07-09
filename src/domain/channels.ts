// Channel identity. Numeric values are firmware-pinned (WIRE_* macros);
// the enum is the domain identifier every UI/layout/routing surface indexes by.

import { AudioInputSource, isSpdifSource } from './deviceSections';

export const ChannelId = {
  In1L: 0,
  In1R: 1,
  Out1L: 2,
  Out1R: 3,
  Out2L: 4,
  Out2R: 5,
  Out3L: 6,
  Out3R: 7,
  Out4L: 8,
  Out4R: 9,
  Pdm: 10,
  // Extra input pairs (RP2350 multichannel input, wire V16+). Ids continue
  // past the V10 block so existing ids stay stable; the hardware profile's
  // wire mapping places them at their on-wire indices.
  In2L: 11,
  In2R: 12,
  In3L: 13,
  In3R: 14,
  In4L: 15,
  In4R: 16,
} as const;
export type ChannelId = (typeof ChannelId)[keyof typeof ChannelId];

export const InputChannelId = {
  In1L: ChannelId.In1L,
  In1R: ChannelId.In1R,
  In2L: ChannelId.In2L,
  In2R: ChannelId.In2R,
  In3L: ChannelId.In3L,
  In3R: ChannelId.In3R,
  In4L: ChannelId.In4L,
  In4R: ChannelId.In4R,
} as const;
export type InputChannelId = (typeof InputChannelId)[keyof typeof InputChannelId];

// Input slot index into crosspoint rows / preamp arrays (0-based, L/R
// interleaved: 0 = In1L .. 7 = In4R). Distinct from ChannelId: RouteModel.
// inputIndex uses this index, not the wire-level id.
export const InputSlot = { Left: 0, Right: 1 } as const;
export type InputSlot = number;

// Output slot index in matrix routes / outputs[] arrays. NOT the wire-level
// ChannelId (outputs start at 2). 0-based slot used by SetOutput*/
// SetMatrixRoute and the bulk crosspoint/output arrays. RP2040 is a compact
// 0..4 matrix (PDM is slot 4); RP2350 is 0..8 (PDM is slot 8).
export const OutputSlot = {
  Out1L: 0, Out1R: 1,
  Out2L: 2, Out2R: 3,
  Out3L: 4, Out3R: 5,
  Out4L: 6, Out4R: 7,
  Pdm: 8, // RP2350/global slot; use HardwareProfile for platform data.
} as const;
export type OutputSlot = (typeof OutputSlot)[keyof typeof OutputSlot];

export type OutputMode = 'SPDIF' | 'I2S' | 'PDM';

// Wire encoding of a stereo pair's output type: each i2s.outputSlotTypes
// entry and SetOutputType's payload byte. PDM is not part of this encoding
// (the PDM sub is a fixed-mode slot outside the pair array).
export const OutputSlotType = { Spdif: 0, I2s: 1 } as const;
export type OutputSlotType = (typeof OutputSlotType)[keyof typeof OutputSlotType];

// Stereo-pair index into i2s.outputSlotTypes (and SetOutputType's wValue).
// NOT an OutputSlot: pairs 0-3 cover output channels in L/R pairs.
export type I2sPairSlot = 0 | 1 | 2 | 3;

export interface ChannelLayout {
  id: ChannelId;
  name: string;
  shortName: string;
  bandCount: number;
  isOutput: boolean;
}

// Firmware allocates 12 wire band slots but enables 10 per channel on both
// platforms and rejects band >= 10; bands 10-11 can never hold data.
const EQ_BAND_COUNT = 10;

export const ALL_CHANNELS: readonly ChannelLayout[] = [
  { id: ChannelId.In1L,  name: 'Input 1 Left',  shortName: 'I1L', bandCount: EQ_BAND_COUNT, isOutput: false },
  { id: ChannelId.In1R,  name: 'Input 1 Right', shortName: 'I1R', bandCount: EQ_BAND_COUNT, isOutput: false },
  { id: ChannelId.Out1L, name: 'Out 1 Left',    shortName: '1L',  bandCount: EQ_BAND_COUNT, isOutput: true  },
  { id: ChannelId.Out1R, name: 'Out 1 Right',   shortName: '1R',  bandCount: EQ_BAND_COUNT, isOutput: true  },
  { id: ChannelId.Out2L, name: 'Out 2 Left',    shortName: '2L',  bandCount: EQ_BAND_COUNT, isOutput: true  },
  { id: ChannelId.Out2R, name: 'Out 2 Right',   shortName: '2R',  bandCount: EQ_BAND_COUNT, isOutput: true  },
  { id: ChannelId.Out3L, name: 'Out 3 Left',    shortName: '3L',  bandCount: EQ_BAND_COUNT, isOutput: true  },
  { id: ChannelId.Out3R, name: 'Out 3 Right',   shortName: '3R',  bandCount: EQ_BAND_COUNT, isOutput: true  },
  { id: ChannelId.Out4L, name: 'Out 4 Left',    shortName: '4L',  bandCount: EQ_BAND_COUNT, isOutput: true  },
  { id: ChannelId.Out4R, name: 'Out 4 Right',   shortName: '4R',  bandCount: EQ_BAND_COUNT, isOutput: true  },
  { id: ChannelId.Pdm,   name: 'PDM',           shortName: 'PDM', bandCount: EQ_BAND_COUNT, isOutput: true  },
  { id: ChannelId.In2L,  name: 'Input 2 Left',  shortName: 'I2L', bandCount: EQ_BAND_COUNT, isOutput: false },
  { id: ChannelId.In2R,  name: 'Input 2 Right', shortName: 'I2R', bandCount: EQ_BAND_COUNT, isOutput: false },
  { id: ChannelId.In3L,  name: 'Input 3 Left',  shortName: 'I3L', bandCount: EQ_BAND_COUNT, isOutput: false },
  { id: ChannelId.In3R,  name: 'Input 3 Right', shortName: 'I3R', bandCount: EQ_BAND_COUNT, isOutput: false },
  { id: ChannelId.In4L,  name: 'Input 4 Left',  shortName: 'I4L', bandCount: EQ_BAND_COUNT, isOutput: false },
  { id: ChannelId.In4R,  name: 'Input 4 Right', shortName: 'I4R', bandCount: EQ_BAND_COUNT, isOutput: false },
] as const;

export function channelLayoutById(id: ChannelId): ChannelLayout {
  const channel = ALL_CHANNELS.find((x) => x.id === id);
  if (!channel) throw new Error(`Unknown ChannelId: ${id}`);
  return channel;
}

export function slotForOutputChannel(id: ChannelId): I2sPairSlot | null {
  if (id < ChannelId.Out1L || id > ChannelId.Out4R) return null;
  return ((id - ChannelId.Out1L) >> 1) as I2sPairSlot;
}

// Input channels in slot order (In1L..In4R = slots 0..7).
const INPUT_SLOT_ORDER: readonly ChannelId[] = [
  ChannelId.In1L, ChannelId.In1R,
  ChannelId.In2L, ChannelId.In2R,
  ChannelId.In3L, ChannelId.In3R,
  ChannelId.In4L, ChannelId.In4R,
];

// InputSlot for an input channel, null for any non-input channel.
export function inputIndexOf(id: ChannelId): InputSlot | null {
  const slot = INPUT_SLOT_ORDER.indexOf(id);
  return slot === -1 ? null : slot;
}

export function inputChannelForSlot(slot: InputSlot): ChannelId | null {
  return INPUT_SLOT_ORDER[slot] ?? null;
}

// Source-aware default input names, mirroring firmware's default-name
// scheme. USB exposes independent per-channel streams with no L/R
// relationship ("USB 1".."USB 8"); I2S and S/PDIF are true stereo pairs.
// Output default names are unaffected -- ALL_CHANNELS' static table
// remains their source of truth.
// Spdif2/Spdif3 select which GPIO the single S/PDIF receiver listens on --
// same receiver, same stereo pair -- so they name identically to Spdif.
export function defaultInputName(source: AudioInputSource, slot: InputSlot): string {
  if (isSpdifSource(source)) return `SPDIF ${slot % 2 === 0 ? 'L' : 'R'}`;
  switch (source) {
    case AudioInputSource.I2s:
      return `I2S ${Math.floor(slot / 2) + 1} ${slot % 2 === 0 ? 'L' : 'R'}`;
    default:
      return `USB ${slot + 1}`;
  }
}

export function defaultInputShortName(source: AudioInputSource, slot: InputSlot): string {
  if (isSpdifSource(source)) return slot % 2 === 0 ? 'SL' : 'SR';
  switch (source) {
    case AudioInputSource.I2s:
      return `I${Math.floor(slot / 2) + 1}${slot % 2 === 0 ? 'L' : 'R'}`;
    default:
      return `U${slot + 1}`;
  }
}

// A rail grouping: one stereo pair (members = [L, R]) or a single channel
// (members = [ch]). accentId is the channel whose palette hue colors the group
// (the L member of a pair). Pairing is by shortName suffix: an 'L'-suffixed
// channel immediately followed by an 'R'-suffixed one. Anything else is a single.
export interface ChannelGroup<T> {
  accentId: ChannelId;
  members: T[];
}

// Splits a display name like "Out 2 Left" into its L/R-stripped base and the
// side letter, for headers that show the side as a small separate glyph.
// Shared by the mixer's row/column headers (MixerTab, MatrixHeader).
export function splitLR(name: string): { base: string; side: string | null } {
  const m = name.match(/^(.+?)\s+([LR])$/);
  return m ? { base: m[1], side: m[2] } : { base: name, side: null };
}

export function groupIntoPairs<T extends { id: ChannelId; shortName: string }>(
  channels: readonly T[],
): ChannelGroup<T>[] {
  const groups: ChannelGroup<T>[] = [];
  for (let i = 0; i < channels.length; i++) {
    const cur = channels[i];
    const next = channels[i + 1];
    if (cur.shortName.endsWith('L') && next?.shortName.endsWith('R')) {
      groups.push({ accentId: cur.id, members: [cur, next] });
      i++;
    } else {
      groups.push({ accentId: cur.id, members: [cur] });
    }
  }
  return groups;
}

// Rail-only variant: groups input channels by slot position (0,1),(2,3),..
// regardless of name suffix. USB default names carry no L/R (each channel is
// an independent stream), so groupIntoPairs can't pair them; the rail still
// wants a stereo-width visual grouping (a 2ch USB source is one pair, 8ch is
// four). Outputs keep the suffix-based grouping above.
export function groupInputSlotPairs<T extends { id: ChannelId }>(
  channels: readonly T[],
): ChannelGroup<T>[] {
  const groups: ChannelGroup<T>[] = [];
  for (let i = 0; i < channels.length; i += 2) {
    const cur = channels[i];
    const next = channels[i + 1];
    groups.push({ accentId: cur.id, members: next ? [cur, next] : [cur] });
  }
  return groups;
}
