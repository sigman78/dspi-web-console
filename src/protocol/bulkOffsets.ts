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
  const dims = Wire.dimsForVersion(version);
  const bandCodec = version >= 22 ? Wire.BandParamsQp : Wire.BandParams;
  const bandSize = Codec.sizeOf(bandCodec);
  let cursor = 0;

  const headerSize = Codec.sizeOf(Wire.Header);
  if (offset < cursor + headerSize) return resolveField('header', Wire.Header, cursor, offset);
  cursor += headerSize;

  const globalCodec = version >= 19 ? Wire.GlobalParams19 : Wire.GlobalParams;
  const globalSize = Codec.sizeOf(globalCodec);
  if (offset < cursor + globalSize) return resolveField('globalParams', globalCodec, cursor, offset);
  cursor += globalSize;

  const crossfeedCodec = version >= 20 ? Wire.CrossfeedParams20 : Wire.CrossfeedParams;
  const crossfeedSize = Codec.sizeOf(crossfeedCodec);
  if (offset < cursor + crossfeedSize) return resolveField('crossfeed', crossfeedCodec, cursor, offset);
  cursor += crossfeedSize;

  const legacySize = Codec.sizeOf(Wire.LegacyChannels);
  if (offset < cursor + legacySize) return { path: `legacyChannels+${offset - cursor}`, leafOffset: cursor };
  cursor += legacySize;

  const delaySize = Codec.sizeOf(Codec.f32);
  const delaysTotal = delaySize * dims.numCh;
  if (offset < cursor + delaysTotal) {
    const idx = Math.floor((offset - cursor) / delaySize);
    return { path: `delaysMs[ch${idx}]`, leaf: Codec.f32, leafOffset: cursor + idx * delaySize };
  }
  cursor += delaysTotal;

  const cpSize = Codec.sizeOf(Wire.Crosspoint);
  const cpTotal = cpSize * dims.numIn * Wire.Const.NUM_OUTPUTS;
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

  const eqTotal = bandSize * dims.numCh * Wire.Const.BANDS_MAX;
  if (offset < cursor + eqTotal) {
    const idx = Math.floor((offset - cursor) / bandSize);
    const c = Math.floor(idx / Wire.Const.BANDS_MAX);
    const b = idx % Wire.Const.BANDS_MAX;
    return resolveField(`eq[ch${c}].band${b}`, bandCodec, cursor + idx * bandSize, offset);
  }
  cursor += eqTotal;

  const nameSize = Codec.sizeOf(Wire.ChannelName);
  const namesTotal = nameSize * dims.numCh;
  if (offset < cursor + namesTotal) {
    const idx = Math.floor((offset - cursor) / nameSize);
    return { path: `channelNames[ch${idx}]`, leaf: Wire.ChannelName, leafOffset: cursor + idx * nameSize };
  }
  cursor += namesTotal;

  if (version >= 3) {
    const size = Codec.sizeOf(Wire.I2SConfig);
    if (offset < cursor + size) return resolveField('i2s', Wire.I2SConfig, cursor, offset);
    cursor += size;
  }

  if (version >= 4) {
    const levellerCodec = version >= 18 ? Wire.LevellerConfig18 : Wire.LevellerConfig;
    const size = Codec.sizeOf(levellerCodec);
    if (offset < cursor + size) return resolveField('leveller', levellerCodec, cursor, offset);
    cursor += size;
  }

  if (version >= 6) {
    const preampCodec = version >= 16 ? Wire.PreampConfig16 : Wire.PreampConfig;
    const preampSize = Codec.sizeOf(preampCodec);
    if (offset < cursor + preampSize) return resolveField('preamp', preampCodec, cursor, offset);
    cursor += preampSize;

    const mvSize = Codec.sizeOf(Wire.MasterVolume);
    if (offset < cursor + mvSize) return resolveField('masterVolume', Wire.MasterVolume, cursor, offset);
    cursor += mvSize;
  }

  if (version >= 7) {
    const inputCodec = version >= 24 ? Wire.InputConfig24 : version >= 21 ? Wire.InputConfig21 : Wire.InputConfig;
    const size = Codec.sizeOf(inputCodec);
    if (offset < cursor + size) return resolveField('inputConfig', inputCodec, cursor, offset);
    cursor += size;
  }

  if (version >= 8) {
    const size = Codec.sizeOf(Wire.LgSoundSync);
    if (offset < cursor + size) return resolveField('lgSoundSync', Wire.LgSoundSync, cursor, offset);
    cursor += size;
  }

  if (version >= 9) {
    const size = Codec.sizeOf(Wire.UserVolume);
    if (offset < cursor + size) return resolveField('userVolume', Wire.UserVolume, cursor, offset);
    cursor += size;
  }

  if (version >= 10) {
    const size = Codec.sizeOf(Wire.DacHwMute);
    if (offset < cursor + size) return resolveField('dacHwMute', Wire.DacHwMute, cursor, offset);
    cursor += size;
  }

  if (version >= 16) {
    const total = bandSize * Wire.Const16.NUM_CHANNELS * Wire.Const16.XOVER_BANDS;
    if (offset < cursor + total) {
      const idx = Math.floor((offset - cursor) / bandSize);
      const c = Math.floor(idx / Wire.Const16.XOVER_BANDS);
      const b = idx % Wire.Const16.XOVER_BANDS;
      return resolveField(`crossover[ch${c}].x${b}`, bandCodec, cursor + idx * bandSize, offset);
    }
    cursor += total;
  }

  if (version >= 17) {
    const size = Codec.sizeOf(Wire.AdatConfig);
    if (offset < cursor + size) return resolveField('adat', Wire.AdatConfig, cursor, offset);
    cursor += size;
  }

  if (version >= 23) {
    const size = Codec.sizeOf(Wire.PsybassParams);
    if (offset < cursor + size) return resolveField('psybass', Wire.PsybassParams, cursor, offset);
    cursor += size;
  }

  if (version >= 25) {
    const size = Codec.sizeOf(Wire.UpmixParams);
    if (offset < cursor + size) return resolveField('upmix', Wire.UpmixParams, cursor, offset);
  }

  return null;
}
