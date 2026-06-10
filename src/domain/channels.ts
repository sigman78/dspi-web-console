// Channel identity. Numeric values are firmware-pinned (WIRE_* macros);
// the enum is the domain identifier every UI/layout/routing surface indexes by.

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
} as const;
export type ChannelId = (typeof ChannelId)[keyof typeof ChannelId];

export const InputChannelId = {
  In1L: ChannelId.In1L,
  In1R: ChannelId.In1R,
} as const;
export type InputChannelId = (typeof InputChannelId)[keyof typeof InputChannelId];

// Stereo-input slot index (0 = Left, 1 = Right). Distinct from ChannelId:
// RouteModel.inputIndex uses this 0-based pair index, not the wire-level id.
export const InputSlot = { Left: 0, Right: 1 } as const;
export type InputSlot = (typeof InputSlot)[keyof typeof InputSlot];

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

export interface ChannelLayout {
  id: ChannelId;
  name: string;
  shortName: string;
  bandCount: number;
  isOutput: boolean;
}

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
] as const;

export function channelLayoutById(id: ChannelId): ChannelLayout {
  const channel = ALL_CHANNELS.find((x) => x.id === id);
  if (!channel) throw new Error(`Unknown ChannelId: ${id}`);
  return channel;
}

export function slotForOutputChannel(id: ChannelId): number | null {
  if (id < ChannelId.Out1L || id > ChannelId.Out4R) return null;
  return (id - ChannelId.Out1L) >> 1;
}

export function displayNameForChannel(id: ChannelId, channelNames: readonly string[]): string {
  const fromDevice = channelNames[id]?.trim();
  return fromDevice || channelLayoutById(id).name;
}

// InputSlot for In1L/In1R, null for any non-input channel. Centralises the
// "exactly one stereo input pair" assumption.
export function inputIndexOf(id: ChannelId): InputSlot | null {
  if (id === ChannelId.In1L) return InputSlot.Left;
  if (id === ChannelId.In1R) return InputSlot.Right;
  return null;
}
