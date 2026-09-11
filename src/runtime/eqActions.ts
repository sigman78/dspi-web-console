import * as Domain from '@/domain';
import * as Clamp from '@/domain/clamp';
import type { ReadySession } from '@/state';
import { write } from './writes.svelte';
import { focusBand } from './focus';

// Linkwitz Transform reinterprets the gain slot as fp (Hz), not dB, and
// carries its own f0/fp/Q0/Qp ranges (see eqLimits.ts) -- clamping it with
// the plain dB gain range would mangle a real fp value.
function clampFilter(filter: Domain.FilterParams): Domain.FilterParams {
  if (filter.type === Domain.FilterType.LinkwitzTransform) {
    return {
      ...filter,
      frequency: Clamp.bandLtFreqHz(filter.frequency),
      q: Clamp.bandLtQ(filter.q),
      gain: Clamp.bandLtFreqHz(filter.gain),
      qp: Clamp.bandLtQ(filter.qp ?? Domain.QP_DEFAULT),
    };
  }
  return {
    ...filter,
    frequency: Clamp.bandFrequencyHz(filter.frequency),
    q: Clamp.bandQ(filter.q),
    gain: Clamp.bandGainDb(filter.gain),
  };
}

export function setEqFilter(s: ReadySession, channel: Domain.ChannelId, band: number, filter: Domain.FilterParams): void {
  const focus = focusBand(s, channel, band, 'peq');
  focus.read();   // throws on a missing channel or an out-of-range band, before scheduling the write
  const clamped = clampFilter(filter);
  void write(s,
    () => s.device.setFilter(channel, band, clamped),
    // setFilter's wire command carries no bypass byte; keep the mirror's
    // live value so a concurrent setBandBypass ack is never clobbered.
    () => focus.modify((cur) => ({ ...clamped, bypass: cur.bypass })),
  );
}

// Copy all bands from source channel onto target channel as N independent granular writes.
export function copyEqBands(s: ReadySession, sourceId: Domain.ChannelId, targetId: Domain.ChannelId): void {
  if (sourceId === targetId) return;
  const src = s.mirror.snapshot.channels.find((c) => c.id === sourceId);
  const tgt = s.mirror.snapshot.channels.find((c) => c.id === targetId);
  if (!src || !tgt) return;
  const len = Math.min(src.filters.length, tgt.filters.length);
  const copied = src.filters.slice(0, len).map(clampFilter);
  for (let i = 0; i < len; i++) {
    const band = i;
    const filter = copied[i];
    void write(s,
      () => s.device.setFilter(targetId, band, filter),
      () => {
        const t = s.mirror.snapshot.channels.find((c) => c.id === targetId);
        // Bypass doesn't travel on setFilter; the target keeps its own.
        if (t) t.filters[band] = { ...filter, bypass: t.filters[band].bypass };
      },
    );
  }
}

// M3 — Per-band EQ bypass. Band edits flow through write() (await-then-patch),
// matching setEqFilter's lane. setFilter does not carry bypass, so bypass is
// a separate granular command.

export function setBandBypass(s: ReadySession, channel: Domain.ChannelId, band: number, bypassed: boolean): void {
  const focus = focusBand(s, channel, band, 'peq');
  focus.read();   // throws on a missing channel or an out-of-range band, before scheduling the write
  void write(s,
    () => s.device.setBandBypass(channel, band, bypassed),
    () => focus.modify((cur) => ({ ...cur, bypass: bypassed })),
  );
}

// Crossover bands (V16+, output channels only). Same lane as the PEQ verbs;
// the device wrapper owns the 20..23 wire band-index offset. Q and gain are
// unused by crossover types but ride the packet for wire parity.
export function setXoverBand(s: ReadySession, channel: Domain.ChannelId, band: number, filter: Domain.FilterParams): void {
  const focus = focusBand(s, channel, band, 'xover');
  focus.read();   // throws on a missing channel or an out-of-range band, before scheduling the write
  const clamped: Domain.FilterParams = { ...filter, frequency: Clamp.bandFrequencyHz(filter.frequency) };
  void write(s,
    () => s.device.setCrossoverBand(channel, band, clamped),
    () => focus.modify((cur) => ({ ...clamped, bypass: cur.bypass })),
  );
}

export function setXoverBypass(s: ReadySession, channel: Domain.ChannelId, band: number, bypassed: boolean): void {
  const focus = focusBand(s, channel, band, 'xover');
  focus.read();   // throws on a missing channel or an out-of-range band, before scheduling the write
  void write(s,
    () => s.device.setCrossoverBypass(channel, band, bypassed),
    () => focus.modify((cur) => ({ ...cur, bypass: bypassed })),
  );
}
