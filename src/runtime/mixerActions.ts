import * as Domain from '@/domain';
import * as Clamp from '@/domain/clamp';
import type { ReadySession } from '@/state';
import { write, scrub } from './writes.svelte';
import { focusChannel, focusOutput, focusRoute } from './focus';

// Empty / whitespace-only input clears the custom name on the device; the
// snapshot mirrors that by falling back to defaultName.
export function setChannelName(s: ReadySession, id: Domain.ChannelId, name: string): void {
  const focus = focusChannel(s, id);
  const ch = focus.read();
  const resolved = name.trim() || ch.defaultName;
  const clamped = Clamp.nameToByteBudget(resolved, Domain.CHANNEL_NAME_MAX_LEN);
  void write(s,
    () => s.device.setChannelName(id, clamped),
    () => focus.modify((c) => ({ ...c, name: clamped })),
  );
}

export function setMasterPreamp(s: ReadySession, db: number): void {
  db = Clamp.preampDb(db);
  scrub(s,
    'masterPreamp',
    () => { s.mirror.snapshot.masterPreampDb = db; },
    () => s.device.setMasterPreamp(db),
  );
}

export function setInputPreamp(s: ReadySession, channel: Domain.InputSlot, db: number): void {
  db = Clamp.preampDb(db);
  const next = s.mirror.snapshot.inputPreampDb.slice();
  next[channel] = db;
  scrub(s,
    `inputPreamp:${channel}`,
    () => { s.mirror.snapshot.inputPreampDb = next; },
    () => s.device.setInputPreamp(channel, db),
  );
}

// Crosspoint verbs are click/commit-paced (no drag), so they use the plain
// write() lane: send first, patch on ack. SetMatrixRoute is a whole-tuple
// command, so the patch is merged in host code -- read the cell, apply the field
// change, send the full tuple. Sequential commits stay consistent because each
// read sees the prior edit's settled mirror (two edits to the same cell within
// one round-trip could clobber, but that's unreachable at click pace). Per-item
// writes also avoid the bulk path's audio mute, so crosspoint stays granular.
function scheduleCrosspointWrite(
  s: ReadySession,
  input: Domain.InputSlot,
  output: Domain.OutputSlot,
  mutate: (r: Domain.RouteModel) => Domain.RouteModel,
): void {
  const route = focusRoute(s, input, output);
  const next = mutate(route.read());
  void write(s,
    () => s.device.setMatrixRoute(input, output, { enabled: next.enabled, invert: next.invert, gainDb: next.gainDb }),
    () => route.modify(() => next),
  );
}

export function setCrosspointGain(s: ReadySession, input: Domain.InputSlot, output: Domain.OutputSlot, gainDb: number): void {
  gainDb = Clamp.crosspointGainDb(gainDb);
  scheduleCrosspointWrite(s, input, output, (r) => ({ ...r, gainDb }));
}

export function setCrosspointEnabled(s: ReadySession, input: Domain.InputSlot, output: Domain.OutputSlot, enabled: boolean): void {
  scheduleCrosspointWrite(s, input, output, (r) => ({ ...r, enabled }));
}

export function setCrosspointInvert(s: ReadySession, input: Domain.InputSlot, output: Domain.OutputSlot, invert: boolean): void {
  scheduleCrosspointWrite(s, input, output, (r) => ({ ...r, invert }));
}

// Click/commit-paced ValueField (no drag): plain write(), patch on ack. Scalar
// verb, no tuple to merge.
export function setOutputGain(s: ReadySession, slot: Domain.OutputSlot, gainDb: number): void {
  gainDb = Clamp.outputGainDb(gainDb);
  const out = focusOutput(s, slot);
  void write(s,
    () => s.device.setOutputGain(slot, gainDb),
    () => out.modify((o) => ({ ...o, gainDb })),
  );
}

export function setOutputDelay(s: ReadySession, slot: Domain.OutputSlot, delayMs: number): void {
  delayMs = Clamp.outputDelayMs(delayMs);
  const out = focusOutput(s, slot);
  void write(s,
    () => s.device.setOutputDelay(slot, delayMs),
    () => out.modify((o) => ({ ...o, delayMs })),
  );
}

export function setOutputEnabled(s: ReadySession, slot: Domain.OutputSlot, enabled: boolean): void {
  const out = focusOutput(s, slot);
  void write(s,
    () => s.device.setOutputEnable(slot, enabled),
    () => out.modify((o) => ({ ...o, enabled })),
  );
}

// Both channels of a stereo pair, normalizing a half-enabled pair to a single
// state. Two independent write()s -- no tuple to merge, same as setOutputEnabled.
export function setOutputPairEnabled(s: ReadySession, pair: Domain.I2sPairSlot, enabled: boolean): void {
  setOutputEnabled(s, (pair * 2) as Domain.OutputSlot, enabled);
  setOutputEnabled(s, (pair * 2 + 1) as Domain.OutputSlot, enabled);
}

export function setOutputMuted(s: ReadySession, slot: Domain.OutputSlot, muted: boolean): void {
  const out = focusOutput(s, slot);
  void write(s,
    () => s.device.setOutputMute(slot, muted),
    () => out.modify((o) => ({ ...o, muted })),
  );
}
