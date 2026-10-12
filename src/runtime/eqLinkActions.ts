import * as Domain from '@/domain';
import type { ReadySession } from '@/state';
import { setEqFilter, setBandBypass, setXoverBand, setXoverBypass, copyEqBands } from './eqActions';
import { setInputPreamp, setOutputGain, setOutputDelay } from './mixerActions';

function channelOf(s: ReadySession, id: Domain.ChannelId): Domain.ChannelModel | undefined {
  return s.mirror.snapshot.channels.find((c) => c.id === id);
}

function sameBand(a: Domain.FilterParams, b: Domain.FilterParams): boolean {
  return Domain.filterParamsEqual(a, b, { bypass: false });
}

type BandKind = 'peq' | 'xover';

function bandsOf(ch: Domain.ChannelModel | undefined, kind: BandKind): Domain.FilterParams[] | undefined {
  return ch ? (kind === 'peq' ? ch.filters : ch.xoverBands) : undefined;
}

function forEachMemberBand(
  s: ReadySession,
  channel: Domain.ChannelId,
  band: number,
  kind: BandKind,
  fn: (id: Domain.ChannelId) => void,
): void {
  for (const id of s.eqLink.membersOf(channel)) {
    if (bandsOf(channelOf(s, id), kind)?.[band] !== undefined) fn(id);
  }
}

export function setEqFilterLinked(s: ReadySession, channel: Domain.ChannelId, band: number, filter: Domain.FilterParams): void {
  forEachMemberBand(s, channel, band, 'peq', (id) => setEqFilter(s, id, band, filter));
}

export function setBandBypassLinked(s: ReadySession, channel: Domain.ChannelId, band: number, bypassed: boolean): void {
  forEachMemberBand(s, channel, band, 'peq', (id) => setBandBypass(s, id, band, bypassed));
}

export function setXoverBandLinked(s: ReadySession, channel: Domain.ChannelId, band: number, filter: Domain.FilterParams): void {
  forEachMemberBand(s, channel, band, 'xover', (id) => setXoverBand(s, id, band, filter));
}

export function setXoverBypassLinked(s: ReadySession, channel: Domain.ChannelId, band: number, bypassed: boolean): void {
  forEachMemberBand(s, channel, band, 'xover', (id) => setXoverBypass(s, id, band, bypassed));
}

export function resetEqLinked(s: ReadySession, channel: Domain.ChannelId): void {
  for (const id of s.eqLink.membersOf(channel)) {
    const len = channelOf(s, id)?.filters.length ?? 0;
    for (let band = 0; band < len; band++) setEqFilter(s, id, band, Domain.defaultFilter());
  }
}

export function pasteEqLinked(s: ReadySession, source: Domain.ChannelId, target: Domain.ChannelId): void {
  for (const id of s.eqLink.membersOf(target)) {
    if (id !== source) copyEqBands(s, source, id);
  }
}

export function setInputPreampLinked(s: ReadySession, channel: Domain.ChannelId, db: number): void {
  for (const id of s.eqLink.membersOf(channel)) {
    const slot = Domain.inputIndexOf(id);
    if (slot !== null) setInputPreamp(s, slot, db);
  }
}

function forEachMemberOutput(
  s: ReadySession,
  channel: Domain.ChannelId,
  fn: (wireIndex: Domain.OutputSlot) => void,
): void {
  for (const id of s.eqLink.membersOf(channel)) {
    const out = s.mirror.snapshot.outputs.find((o) => o.id === id);
    if (out) fn(out.wireIndex);
  }
}

export function setOutputGainLinked(s: ReadySession, channel: Domain.ChannelId, db: number): void {
  forEachMemberOutput(s, channel, (slot) => setOutputGain(s, slot, db));
}

export function setOutputDelayLinked(s: ReadySession, channel: Domain.ChannelId, ms: number): void {
  forEachMemberOutput(s, channel, (slot) => setOutputDelay(s, slot, ms));
}

// Copies the channel's values onto every other group member, writing only
// the items that differ.
export function syncEqLinkFrom(s: ReadySession, channel: Domain.ChannelId): void {
  const group = s.eqLink.groupOf(channel);
  const src = channelOf(s, channel);
  if (!group || !src) return;
  const snap = s.mirror.snapshot;
  const srcOut = snap.outputs.find((o) => o.id === channel);
  const srcSlot = Domain.inputIndexOf(channel);

  for (const id of group) {
    if (id === channel) continue;
    const dst = channelOf(s, id);
    if (dst) {
      const peqLen = Math.min(src.filters.length, dst.filters.length);
      for (let band = 0; band < peqLen; band++) {
        const a = src.filters[band];
        const b = dst.filters[band];
        if (!sameBand(a, b)) setEqFilter(s, id, band, a);
        if (a.bypass !== b.bypass) setBandBypass(s, id, band, a.bypass);
      }
      const xoverLen = Math.min(src.xoverBands.length, dst.xoverBands.length);
      for (let band = 0; band < xoverLen; band++) {
        const a = src.xoverBands[band];
        const b = dst.xoverBands[band];
        if (!sameBand(a, b)) setXoverBand(s, id, band, a);
        if (a.bypass !== b.bypass) setXoverBypass(s, id, band, a.bypass);
      }
    }

    const dstOut = snap.outputs.find((o) => o.id === id);
    if (srcOut && dstOut) {
      if (srcOut.gainDb !== dstOut.gainDb) setOutputGain(s, dstOut.wireIndex, srcOut.gainDb);
      if (srcOut.delayMs !== dstOut.delayMs) setOutputDelay(s, dstOut.wireIndex, srcOut.delayMs);
    }

    const dstSlot = Domain.inputIndexOf(id);
    if (srcSlot !== null && dstSlot !== null) {
      const db = snap.inputPreampDb[srcSlot];
      if (db !== undefined && db !== snap.inputPreampDb[dstSlot]) setInputPreamp(s, dstSlot, db);
    }
  }
}

export function setEqLinkLocked(s: ReadySession, channel: Domain.ChannelId, on: boolean): void {
  if (on) {
    syncEqLinkFrom(s, channel);
    s.eqLink.setLocked(channel, true);
  } else {
    s.eqLink.setLocked(channel, false);
  }
}
