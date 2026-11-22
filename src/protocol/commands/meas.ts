import * as Wire from '../wireTypes';
import { PagedCmd } from '../paged.gen';
import type { ActionCommand, Command, RawCommand } from './types';

type RtaConfigPayload = {
  version: number; tap: number; channelMask: number; fftOrder: number;
  avgMs: number; peakDecayDbS: number; flags: number;
};

export const MeasCmd = {
  Status: { legacy: { get: 0x50 } } satisfies RawCommand,
  ClearClips: { legacy: { get: 0x83 } } satisfies RawCommand,
  // Paged meter packet (the 1.1.6 selector 9 bytes) and the clip-flag clear.
  Levels: { legacy: {}, paged: { get: PagedCmd.MEAS.LEVELS.id } } satisfies RawCommand,
  ClipClear: { legacy: {}, paged: { set: PagedCmd.MEAS.CLIP_CLEAR.id } } satisfies RawCommand,

  // --- Onboard RTA (layout V3 = fw 1.1.6-beta4+; wire V30+ is only a try-gate).
  // Raw plumbing on DspDevice:
  // GET_CAPS wValue 0 = RtaCaps, 1.. = band-centre chunks; GET_BANDS wValue =
  // channel; GET_BANDS_ALL answers every live channel's frame back to back
  // (zero bytes when none is live). Every band read keeps the analyser alive
  // for ~5 s; GET_STATUS does not.
  RtaConfig: { codec: Wire.RtaConfig, legacy: { get: 0x09, set: 0x08 } } satisfies Command<RtaConfigPayload>,
  RtaCaps: { legacy: { get: 0x0A } } satisfies RawCommand,
  RtaBands: { legacy: { get: 0x0B } } satisfies RawCommand,
  RtaBins: { legacy: { get: 0x0C } } satisfies RawCommand,
  RtaStatus: { legacy: { get: 0x0D } } satisfies RawCommand,
  RtaBandsAll: { legacy: { get: 0x0F } } satisfies RawCommand,
} as const;

export const MeasAct = {
  RtaControl: { legacy: { code: 0x0E } } satisfies ActionCommand,
} as const;
