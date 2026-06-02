import {
  type FilterParams,
  type ChannelId, type InputSlot, type OutputSlot,
  type RouteModel,
  type I2sConfig,
  CrossfeedPreset, LevellerSpeed, MasterVolumeMode,
  CHANNEL_NAME_MAX_LEN,
} from '@/domain';
import * as Clamp from '@/domain/clamp';
import {
  type ReadySession,
  session,
  presets,
  settings,
  status,
  pushNotice,
} from '@/state';
import { Log } from '@/utils';
import { mirror } from '@/state/mirror.svelte';
import { write, scrub, writeChecked, command } from './writes';
import { focusOutput, focusRoute } from './focus';


function _setMasterVolume(db: number): void {
  const d = session.device;
  if (!d) return;
  scrub(
    'masterVolume',
    () => { if (mirror.current) mirror.current.masterVolumeDb = db; },
    () => d.setMasterVolume(db),
  );
}

export function setEqFilter(channel: ChannelId, band: number, filter: FilterParams): void {
  if (!mirror.current?.channels) return;
  const ch = mirror.current.channels.find((c) => c.id === channel);
  if (!ch) return;
  if (band >= ch.filters.length) {
    throw new Error(`band ${band} out of range for channel ${channel}`);
  }
  const clamped: FilterParams = {
    ...filter,
    frequency: Clamp.bandFrequencyHz(filter.frequency),
    q: Clamp.bandQ(filter.q),
    gain: Clamp.bandGainDb(filter.gain),
  };
  const d = session.device;
  if (!d) return;
  void write(
    () => d.setFilter(channel, band, clamped),
    () => {
      const c = mirror.current?.channels.find((c) => c.id === channel);
      if (c) c.filters[band] = { ...clamped };
    },
  );
}

// Copy all bands from source channel onto target channel as N independent granular writes.
export function copyEqBands(sourceId: ChannelId, targetId: ChannelId): void {
  if (sourceId === targetId || !mirror.current?.channels) return;
  const src = mirror.current.channels.find((c) => c.id === sourceId);
  const tgt = mirror.current.channels.find((c) => c.id === targetId);
  if (!src || !tgt) return;
  const len = Math.min(src.filters.length, tgt.filters.length);
  const copied = src.filters.slice(0, len).map((f) => ({
    ...f,
    frequency: Clamp.bandFrequencyHz(f.frequency),
    q: Clamp.bandQ(f.q),
    gain: Clamp.bandGainDb(f.gain),
  }));
  const d = session.device;
  if (!d) return;
  for (let i = 0; i < len; i++) {
    const band = i;
    const filter = copied[i];
    void write(
      () => d.setFilter(targetId, band, filter),
      () => {
        if (!mirror.current) return;
        const t = mirror.current.channels.find((c) => c.id === targetId);
        if (t) t.filters[band] = { ...filter };
      },
    );
  }
}

export function setBypass(enabled: boolean): void {
  const d = session.device;
  if (!d) return;
  void write(
    () => d.setBypass(enabled),
    () => { if (mirror.current) mirror.current.bypass = enabled; },
  );
}

// Telemetry-only action: clears firmware-side latched clip flags (0x83) and
// resets the host-side OR-latch (`status.clipLatched`). Not routed through
// the write/scrub helpers because clip state lives in telemetry, not the
// DSP snapshot, so the post-send resync would be pure overhead. If the
// wire send fails, the host array stays cleared — the next poll cycle
// will re-latch from `clipFlags` if firmware still sees the condition.
export function clearClips(): void {
  const d = session.device;
  if (!d) return;
  for (let i = 0; i < status.clipLatched.length; i++) status.clipLatched[i] = false;
  void d.clearClips().catch((e) => Log.error('clearClips', 'send failed', e));
}

// Empty / whitespace-only input clears the custom name on the device; the
// snapshot mirrors that by falling back to defaultName, matching what
// `displayNameForChannel` produces after a bulk resync. The outputs[]
// name mirror keeps MatrixHeader and OverviewTab in sync without waiting
// for the trailing bulk resync.
export function setChannelName(id: ChannelId, name: string): void {
  if (!mirror.current?.channels) return;
  const ch = mirror.current.channels.find((c) => c.id === id);
  if (!ch) return;
  const resolved = name.trim() || ch.defaultName;
  const clamped = Clamp.nameToByteBudget(resolved, CHANNEL_NAME_MAX_LEN);
  const d = session.device;
  if (!d) return;
  void write(
    () => d.setChannelName(id, clamped),
    () => {
      if (!mirror.current) return;
      const c = mirror.current.channels.find((c) => c.id === id);
      if (c) c.name = clamped;
      const o = mirror.current.outputs.find((o) => o.id === id);
      if (o) o.name = clamped;
    },
  );
}

export function setLoudnessEnabled(s: ReadySession, enabled: boolean): void {
  void write(
    () => s.device.setLoudnessEnabled(enabled),
    () => { s.mirror.snapshot.loudness.enabled = enabled; },
  );
}

export function setLoudnessRefSpl(s: ReadySession, db: number): void {
  db = Clamp.loudnessRefSpl(db);
  scrub(
    'loudnessRefSpl',
    () => { s.mirror.snapshot.loudness.refSpl = db; },
    () => s.device.setLoudnessRefSpl(db),
  );
}

export function setLoudnessIntensityPct(s: ReadySession, pct: number): void {
  pct = Clamp.loudnessIntensityPct(pct);
  scrub(
    'loudnessIntensity',
    () => { s.mirror.snapshot.loudness.intensityPct = pct; },
    () => s.device.setLoudnessIntensity(pct),
  );
}

export function setCrossfeedEnabled(enabled: boolean): void {
  const d = session.device;
  if (!d) return;
  void write(
    () => d.setCrossfeedEnabled(enabled),
    () => { if (mirror.current) mirror.current.crossfeed.enabled = enabled; },
  );
}

export function setCrossfeedPreset(preset: CrossfeedPreset): void {
  const d = session.device;
  if (!d) return;
  void write(
    () => d.setCrossfeedPreset(preset),
    () => { if (mirror.current) mirror.current.crossfeed.preset = preset; },
  );
}

export function setCrossfeedItd(itd: boolean): void {
  const d = session.device;
  if (!d) return;
  void write(
    () => d.setCrossfeedItd(itd),
    () => { if (mirror.current) mirror.current.crossfeed.itd = itd; },
  );
}

export function setCrossfeedFreq(hz: number): void {
  hz = Clamp.crossfeedFreqHz(hz);
  const d = session.device;
  if (!d) return;
  scrub(
    'crossfeedFreq',
    () => { if (mirror.current) mirror.current.crossfeed.freq = hz; },
    () => d.setCrossfeedFreq(hz),
  );
}

export function setCrossfeedFeedDb(db: number): void {
  db = Clamp.crossfeedFeedDb(db);
  const d = session.device;
  if (!d) return;
  scrub(
    'crossfeedFeedDb',
    () => { if (mirror.current) mirror.current.crossfeed.feedDb = db; },
    () => d.setCrossfeedFeedDb(db),
  );
}

export function setLevellerEnabled(enabled: boolean): void {
  const d = session.device;
  if (!d) return;
  void write(
    () => d.setLevellerEnabled(enabled),
    () => { if (mirror.current?.leveller) mirror.current.leveller.enabled = enabled; },
  );
}

export function setLevellerSpeed(speed: LevellerSpeed): void {
  const d = session.device;
  if (!d) return;
  void write(
    () => d.setLevellerSpeed(speed),
    () => { if (mirror.current?.leveller) mirror.current.leveller.speed = speed; },
  );
}

export function setLevellerLookahead(lookahead: boolean): void {
  const d = session.device;
  if (!d) return;
  void write(
    () => d.setLevellerLookahead(lookahead),
    () => { if (mirror.current?.leveller) mirror.current.leveller.lookahead = lookahead; },
  );
}

export function setLevellerAmount(pct: number): void {
  pct = Clamp.levellerAmountPct(pct);
  const d = session.device;
  if (!d) return;
  scrub(
    'levellerAmount',
    () => { if (mirror.current?.leveller) mirror.current.leveller.amount = pct; },
    () => d.setLevellerAmount(pct),
  );
}

export function setLevellerMaxGain(db: number): void {
  db = Clamp.levellerMaxGainDb(db);
  const d = session.device;
  if (!d) return;
  scrub(
    'levellerMaxGain',
    () => { if (mirror.current?.leveller) mirror.current.leveller.maxGainDb = db; },
    () => d.setLevellerMaxGain(db),
  );
}

export function setLevellerGate(db: number): void {
  db = Clamp.levellerGateDb(db);
  const d = session.device;
  if (!d) return;
  scrub(
    'levellerGate',
    () => { if (mirror.current?.leveller) mirror.current.leveller.gateDb = db; },
    () => d.setLevellerGate(db),
  );
}

export function setMasterPreamp(db: number): void {
  db = Clamp.preampDb(db);
  const d = session.device;
  if (!d) return;
  scrub(
    'masterPreamp',
    () => { if (mirror.current) mirror.current.masterPreampDb = db; },
    () => d.setMasterPreamp(db),
  );
}

export function setInputPreamp(channel: InputSlot, db: number): void {
  db = Clamp.preampDb(db);
  const cur = mirror.current?.inputPreampDb;
  if (!cur) return;
  const next: [number, number] = [cur[0], cur[1]];
  next[channel] = db;
  const d = session.device;
  if (!d) return;
  scrub(
    `inputPreamp:${channel}`,
    () => { if (mirror.current) mirror.current.inputPreampDb = next; },
    () => d.setInputPreamp(channel, db),
  );
}

// All three crosspoint verbs are click/commit-paced (button + ValueField, no
// drag), so they use the plain write() lane: send first, patch the mirror on
// ack. SetMatrixRoute is a whole-tuple command, so the patch is merged in host
// code — read the current cell, apply the field change, send the full tuple.
// Sequential commits stay consistent because each read sees the prior edit's
// settled mirror. (Two edits to the same cell within one USB round-trip could
// clobber, but that's unreachable at click pace; add a coalesce key if a
// programmatic same-cell burst is ever introduced.) Per-item writes also avoid
// the bulk path's audio mute, which is why crosspoint stays granular.
function scheduleCrosspointWrite(
  input: InputSlot,
  output: OutputSlot,
  mutate: (r: RouteModel) => RouteModel,
): void {
  if (!mirror.current?.routes) return;
  const route = focusRoute(input, output);
  const d = session.device;
  if (!d) return;
  const next = mutate(route.read());
  void write(
    () => d.setMatrixRoute(input, output, { enabled: next.enabled, invert: next.invert, gainDb: next.gainDb }),
    () => route.modify(() => next),
  );
}

export function setCrosspointGain(input: InputSlot, output: OutputSlot, gainDb: number): void {
  gainDb = Clamp.crosspointGainDb(gainDb);
  scheduleCrosspointWrite(input, output, (r) => ({ ...r, gainDb }));
}

export function setCrosspointEnabled(input: InputSlot, output: OutputSlot, enabled: boolean): void {
  scheduleCrosspointWrite(input, output, (r) => ({ ...r, enabled }));
}

export function setCrosspointInvert(input: InputSlot, output: OutputSlot, invert: boolean): void {
  scheduleCrosspointWrite(input, output, (r) => ({ ...r, invert }));
}

// Click/commit-paced ValueField (no drag): plain write(), patch the mirror on
// ack. Scalar verb — no tuple to merge. Mirrors its sibling setOutputDelay.
export function setOutputGain(slot: OutputSlot, gainDb: number): void {
  gainDb = Clamp.outputGainDb(gainDb);
  if (!mirror.current?.outputs) return;
  const out = focusOutput(slot);
  const d = session.device;
  if (!d) return;
  void write(
    () => d.setOutputGain(slot, gainDb),
    () => out.modify((o) => ({ ...o, gainDb })),
  );
}

// Write-path output addressing: locate the output by wire slot in the draft
// being mutated. A missing slot is a silent no-op.
export function setOutputDelay(slot: OutputSlot, delayMs: number): void {
  if (!mirror.current?.outputs) return;
  delayMs = Clamp.outputDelayMs(delayMs);
  const d = session.device;
  if (!d) return;
  void write(
    () => d.setOutputDelay(slot, delayMs),
    () => {
      if (!mirror.current) return;
      const o = mirror.current.outputs.find((o) => o.wireIndex === slot);
      if (o) o.delayMs = delayMs;
    },
  );
}

export function setOutputEnabled(slot: OutputSlot, enabled: boolean): void {
  if (!mirror.current?.outputs) return;
  const d = session.device;
  if (!d) return;
  void write(
    () => d.setOutputEnable(slot, enabled),
    () => {
      if (!mirror.current) return;
      const o = mirror.current.outputs.find((o) => o.wireIndex === slot);
      if (o) o.enabled = enabled;
    },
  );
}

export function setOutputMuted(slot: OutputSlot, muted: boolean): void {
  if (!mirror.current?.outputs) return;
  const d = session.device;
  if (!d) return;
  void write(
    () => d.setOutputMute(slot, muted),
    () => {
      if (!mirror.current) return;
      const o = mirror.current.outputs.find((o) => o.wireIndex === slot);
      if (o) o.muted = muted;
    },
  );
}

export function setMasterVolume(db: number): void {
  db = Clamp.masterVolumeDb(db);
  if (settings.soft.muted) {
    settings.soft.muted = false;
    settings.soft.mutedFromDb = null;
  }
  _setMasterVolume(db);
}

export function toggleMute(): void {
  if (!session.device) return;
  if (settings.soft.muted) {
    const restore = settings.soft.mutedFromDb ?? 0;
    settings.soft.muted = false;
    settings.soft.mutedFromDb = null;
    _setMasterVolume(restore);
  } else {
    settings.soft.mutedFromDb = mirror.current?.masterVolumeDb ?? 0;
    settings.soft.muted = true;
    _setMasterVolume(Clamp.MUTE_DB);
  }
}

// Master-volume mode --------------------------------------------------------

export function setMasterVolumeMode(mode: MasterVolumeMode): void {
  const d = session.device;
  if (!d) return;
  void command('set master volume mode', () => d.setMasterVolumeMode(mode), () => {
    if (presets.directory) presets.directory = { ...presets.directory, masterVolumeMode: mode };
  });
}

// 0xD6 SaveMasterVolume — writes the directory's boot-baseline volume.
// In Mode 0 this is the post-boot starting volume; in Mode 1 firmware
// accepts the call but it's dormant until the user flips back to Mode 0.
// Fire-and-forget: only failure surfaces (warn here, or an error toast on a
// throw via command). Success is silent — the Save button's state conveys it.
export function saveMasterVolumeBaseline(): void {
  const d = session.device;
  if (!d) return;
  void command('save master volume', () => d.saveMasterVolume(), (ok) => {
    if (!ok) { pushNotice('warn', 'Saving master volume failed (flash write error).'); return; }
    // Device saved its current master volume as the boot baseline → mirror it
    // so the Save button settles to clean without a refetch.
    if (mirror.current) presets.savedMasterVolumeDb = mirror.current.masterVolumeDb;
  });
}

// Output pin / I2S config verbs -------------------------------------------
// Discrete (commit-paced) config commands on the writeChecked() lane: guard
// prerequisites explicitly, send the typed command, and patch the mirror with
// the requested value on ack (no readback). Patching on ack (not before the
// send) keeps the mirror unchanged when the device rejects the command; the
// rejection surfaces as a warn toast and the background poll reconciles to
// committed truth. Never calls syncDeviceSnapshot (would discard unsaved
// EQ/mixer edits). setOutputType's SET is queued, not applied (the switch is
// deferred in firmware) — the optimistic patch + reconcile converge to truth.

function patchI2s(update: (i: I2sConfig) => I2sConfig): void {
  if (mirror.current?.i2s) mirror.current.i2s = update(mirror.current.i2s);
}

function patchOutputPin(index: number, pin: number): void {
  const m = mirror.current;
  if (!m) return;
  const pins = m.outputPins.slice();
  pins[index] = pin;
  m.outputPins = pins;
}

export function setOutputDataPin(pinOutputIndex: number, pin: number): void {
  if (!mirror.current) return;
  const d = session.device;
  if (!d) return;
  void writeChecked(
    'set output pin',
    () => d.setOutputPin(pinOutputIndex, pin),
    () => patchOutputPin(pinOutputIndex, pin),
  );
}

export function setOutputType(slot: OutputSlot, type: number): void {
  if (!mirror.current?.i2s) return;
  const d = session.device;
  if (!d) return;
  void writeChecked(
    'switch output type',
    () => d.setOutputType(slot, type),
    () => patchI2s((i) => ({
      ...i,
      outputSlotTypes: i.outputSlotTypes.map((x, j) => (j === slot ? type : x)) as [number, number, number, number],
    })),
  );
}

export function setI2sBckPin(pin: number): void {
  if (!mirror.current?.i2s) return;
  const d = session.device;
  if (!d) return;
  void writeChecked('set I2S BCK pin', () => d.setI2sBckPin(pin), () => patchI2s((i) => ({ ...i, bckPin: pin })));
}

export function setMckEnabled(on: boolean): void {
  if (!mirror.current?.i2s) return;
  const d = session.device;
  if (!d) return;
  void writeChecked('set MCK enable', () => d.setMckEnable(on), () => patchI2s((i) => ({ ...i, mckEnabled: on })));
}

export function setMckPin(pin: number): void {
  if (!mirror.current?.i2s) return;
  const d = session.device;
  if (!d) return;
  void writeChecked('set MCK pin', () => d.setMckPin(pin), () => patchI2s((i) => ({ ...i, mckPin: pin })));
}

export function setMckMultiplier(encoded: number): void {
  if (!mirror.current?.i2s) return;
  const d = session.device;
  if (!d) return;
  void writeChecked('set MCK multiplier', () => d.setMckMultiplier(encoded), () => patchI2s((i) => ({ ...i, mckMultiplierEncoded: encoded })));
}
