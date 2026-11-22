import { Codec } from '@/utils';
import type { ChannelId, FilterType } from '@/domain';
import * as Wire from '../wireTypes';
import { tighten } from './tighten';
import type { Command, RawCommand } from './types';

type SetEqParamPayload = {
  channel: ChannelId; band: number; type: FilterType; bypass: number;
  frequency: number; q: number; gain: number;
};

export const FilterCmd = {
  // EQ: Set carries the 16-byte filter struct as payload (wValue=0).
  //     Get uses bit-packed wValue (channel<<8 | band<<4 | param); see DspDevice.getFilter.
  EqParam: { codec: tighten<SetEqParamPayload>(Wire.SetFilterPacket), legacy: { set: 0x42 } } satisfies Command<SetEqParamPayload>,
  EqParamValue: { legacy: { get: 0x43 } } satisfies RawCommand,

  // Bypass: master EQ bypass (1 B bool, wValue=0).
  Bypass: { codec: Codec.bool8, legacy: { get: 0x47, set: 0x46 } } satisfies Command<boolean>,

  // --- Granular surface (docs/HW-DSPUSB.md) ---
  // Per-band EQ bypass: wValue = (channel<<8)|band, 1-byte body.
  BandBypass: { codec: Codec.bool8, legacy: { get: 0xD9, set: 0xD8 } } satisfies Command<boolean>,
} as const;
