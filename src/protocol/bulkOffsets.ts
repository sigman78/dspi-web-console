// Diagnostics-only offset resolver for the wire monitor's paramChanged
// enrichment (`?log=wire`). Given a byte offset into a PARAM_CHANGED splice
// and the packet's bulk wire version, walks the same section order as
// bulkParser.ts's parseBulkParams to name the field that offset lands in.
// Built fresh on every call -- clarity over speed, since this never runs
// outside the monitor.

import { Codec, type BinCodec } from '@/utils';
import * as Wire from './wireTypes';

export interface BulkOffsetHit {
  path: string;
  leaf?: BinCodec<unknown>;
  leafOffset: number;
}

function stripPad(name: string): string {
  return name.startsWith('_') ? name.slice(1) : name;
}

// Locates the field of a struct codec containing `offset`, given the
// section's own starting offset. Falls back to naming the section itself
// when the codec carries no field metadata.
function resolveField(sectionPath: string, codec: BinCodec<unknown>, sectionOffset: number, offset: number): BulkOffsetHit {
  const fields = codec.fields;
  if (!fields) return { path: sectionPath, leaf: codec, leafOffset: sectionOffset };
  let fieldOffset = sectionOffset;
  for (const [name, fieldCodec] of fields) {
    const size = fieldCodec.size;
    if (size === undefined) break;
    if (offset < fieldOffset + size) {
      return { path: `${sectionPath}.${stripPad(name)}`, leaf: fieldCodec, leafOffset: fieldOffset };
    }
    fieldOffset += size;
  }
  return { path: sectionPath, leafOffset: sectionOffset };
}

export function describeBulkOffset(offset: number, version: number): BulkOffsetHit | null {
  if (offset < 0) return null;
  const bandCodec = Wire.BandParams;
  const bandSize = Codec.sizeOf(bandCodec);
  let cursor = 0;

  const headerSize = Codec.sizeOf(Wire.Header);
  if (offset < cursor + headerSize) return resolveField('header', Wire.Header, cursor, offset);
  cursor += headerSize;

  const globalCodec = Wire.GlobalParams;
  const globalSize = Codec.sizeOf(globalCodec);
  if (offset < cursor + globalSize) return resolveField('globalParams', globalCodec, cursor, offset);
  cursor += globalSize;

  const crossfeedCodec = Wire.CrossfeedParams;
  const crossfeedSize = Codec.sizeOf(crossfeedCodec);
  if (offset < cursor + crossfeedSize) return resolveField('crossfeed', crossfeedCodec, cursor, offset);
  cursor += crossfeedSize;

  const legacySize = Codec.sizeOf(Wire.LegacyChannels);
  if (offset < cursor + legacySize) return { path: `legacyChannels+${offset - cursor}`, leafOffset: cursor };
  cursor += legacySize;

  const delaySize = Codec.sizeOf(Codec.f32);
  const delaysTotal = delaySize * Wire.Const.NUM_CHANNELS;
  if (offset < cursor + delaysTotal) {
    const idx = Math.floor((offset - cursor) / delaySize);
    return { path: `delaysMs[ch${idx}]`, leaf: Codec.f32, leafOffset: cursor + idx * delaySize };
  }
  cursor += delaysTotal;

  const cpSize = Codec.sizeOf(Wire.Crosspoint);
  const cpTotal = cpSize * Wire.Const.NUM_INPUTS * Wire.Const.NUM_OUTPUTS;
  if (offset < cursor + cpTotal) {
    const idx = Math.floor((offset - cursor) / cpSize);
    const i = Math.floor(idx / Wire.Const.NUM_OUTPUTS);
    const o = idx % Wire.Const.NUM_OUTPUTS;
    return resolveField(`crosspoint[in${i}][out${o}]`, Wire.Crosspoint, cursor + idx * cpSize, offset);
  }
  cursor += cpTotal;

  const outSize = Codec.sizeOf(Wire.OutputChannel);
  const outTotal = outSize * Wire.Const.NUM_OUTPUTS;
  if (offset < cursor + outTotal) {
    const idx = Math.floor((offset - cursor) / outSize);
    return resolveField(`outputs[${idx}]`, Wire.OutputChannel, cursor + idx * outSize, offset);
  }
  cursor += outTotal;

  const pinSize = Codec.sizeOf(Wire.PinConfig);
  if (offset < cursor + pinSize) return resolveField('pinConfig', Wire.PinConfig, cursor, offset);
  cursor += pinSize;

  const eqTotal = bandSize * Wire.Const.NUM_CHANNELS * Wire.Const.BANDS_MAX;
  if (offset < cursor + eqTotal) {
    const idx = Math.floor((offset - cursor) / bandSize);
    const c = Math.floor(idx / Wire.Const.BANDS_MAX);
    const b = idx % Wire.Const.BANDS_MAX;
    return resolveField(`eq[ch${c}].band${b}`, bandCodec, cursor + idx * bandSize, offset);
  }
  cursor += eqTotal;

  const nameSize = Codec.sizeOf(Wire.ChannelName);
  const namesTotal = nameSize * Wire.Const.NUM_CHANNELS;
  if (offset < cursor + namesTotal) {
    const idx = Math.floor((offset - cursor) / nameSize);
    return { path: `channelNames[ch${idx}]`, leaf: Wire.ChannelName, leafOffset: cursor + idx * nameSize };
  }
  cursor += namesTotal;

  const i2sSize = Codec.sizeOf(Wire.I2SConfig);
  if (offset < cursor + i2sSize) return resolveField('i2s', Wire.I2SConfig, cursor, offset);
  cursor += i2sSize;

  const levellerCodec = Wire.LevellerConfig;
  const levellerSize = Codec.sizeOf(levellerCodec);
  if (offset < cursor + levellerSize) return resolveField('leveller', levellerCodec, cursor, offset);
  cursor += levellerSize;

  const preampCodec = Wire.PreampConfig;
  const preampSize = Codec.sizeOf(preampCodec);
  if (offset < cursor + preampSize) return resolveField('preamp', preampCodec, cursor, offset);
  cursor += preampSize;

  const mvSize = Codec.sizeOf(Wire.MasterVolume);
  if (offset < cursor + mvSize) return resolveField('masterVolume', Wire.MasterVolume, cursor, offset);
  cursor += mvSize;

  const inputCodec = Wire.InputConfig;
  const inputSize = Codec.sizeOf(inputCodec);
  if (offset < cursor + inputSize) return resolveField('inputConfig', inputCodec, cursor, offset);
  cursor += inputSize;

  const lgSize = Codec.sizeOf(Wire.LgSoundSync);
  if (offset < cursor + lgSize) return resolveField('lgSoundSync', Wire.LgSoundSync, cursor, offset);
  cursor += lgSize;

  const userVolSize = Codec.sizeOf(Wire.UserVolume);
  if (offset < cursor + userVolSize) return resolveField('userVolume', Wire.UserVolume, cursor, offset);
  cursor += userVolSize;

  const dacSize = Codec.sizeOf(Wire.DacHwMute);
  if (offset < cursor + dacSize) return resolveField('dacHwMute', Wire.DacHwMute, cursor, offset);
  cursor += dacSize;

  const xoverTotal = bandSize * Wire.Const.NUM_CHANNELS * Wire.Const.XOVER_BANDS;
  if (offset < cursor + xoverTotal) {
    const idx = Math.floor((offset - cursor) / bandSize);
    const c = Math.floor(idx / Wire.Const.XOVER_BANDS);
    const b = idx % Wire.Const.XOVER_BANDS;
    return resolveField(`crossover[ch${c}].x${b}`, bandCodec, cursor + idx * bandSize, offset);
  }
  cursor += xoverTotal;

  const adatSize = Codec.sizeOf(Wire.AdatConfig);
  if (offset < cursor + adatSize) return resolveField('adat', Wire.AdatConfig, cursor, offset);
  cursor += adatSize;

  const psySize = Codec.sizeOf(Wire.PsybassParams);
  if (offset < cursor + psySize) return resolveField('psybass', Wire.PsybassParams, cursor, offset);
  cursor += psySize;

  const upmixSize = Codec.sizeOf(Wire.UpmixParams);
  if (offset < cursor + upmixSize) return resolveField('upmix', Wire.UpmixParams, cursor, offset);
  cursor += upmixSize;

  if (version >= 29) {
    const size = Codec.sizeOf(Wire.SubharmParams);
    if (offset < cursor + size) return resolveField('subharm', Wire.SubharmParams, cursor, offset);
    cursor += size;
  }

  if (version >= 30) {
    const size = Codec.sizeOf(Wire.SubharmParamsExt);
    if (offset < cursor + size) return resolveField('subharm', Wire.SubharmParamsExt, cursor, offset);
    cursor += size;
  }

  if (version >= 31) {
    const size = Codec.sizeOf(Wire.TubeParams);
    if (offset < cursor + size) return resolveField('tube', Wire.TubeParams, cursor, offset);
    cursor += size;
  }

  if (version >= 32) {
    const entrySize = Codec.sizeOf(Wire.LimiterEntry);
    if (offset < cursor + entrySize * Wire.Const.NUM_OUTPUTS) {
      const idx = Math.floor((offset - cursor) / entrySize);
      return resolveField(`limiter[${idx}]`, Wire.LimiterEntry, cursor + idx * entrySize, offset);
    }
  }

  return null;
}
