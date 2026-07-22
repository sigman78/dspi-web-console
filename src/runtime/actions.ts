import {
  type FilterParams,
  type ChannelId, type InputSlot, type OutputSlot, type I2sPairSlot,
  type RouteModel,
  type I2sConfig,
  type DacHwMute,
  type UartControlConfig, type I2cControlConfig,
  type CsBinding,
  type CsIrCommand,
  AudioInputSource, CsType, EMPTY_CS_BINDING,
  CsIrProto, EMPTY_CS_IR_COMMAND, CS_IR_LEARN_ARMED,
  CrossfeedPreset, LevellerSpeed, MasterVolumeMode,
  CHANNEL_NAME_MAX_LEN,
  FilterType, QP_DEFAULT,
} from '@/domain';
import * as Clamp from '@/domain/clamp';
import {
  type ReadySession,
  pushNotice,
} from '@/state';
import { Wire } from '@/protocol';
import { Log, errMessage } from '@/utils';
import { write, scrub, writeChecked, command } from './writes.svelte';
import { focusOutput, focusRoute } from './focus';

// Linkwitz Transform reinterprets the gain slot as fp (Hz), not dB, and
// carries its own f0/fp/Q0/Qp ranges (see eqLimits.ts) -- clamping it with
// the plain dB gain range would mangle a real fp value.
function clampFilter(filter: FilterParams): FilterParams {
  if (filter.type === FilterType.LinkwitzTransform) {
    return {
      ...filter,
      frequency: Clamp.bandLtFreqHz(filter.frequency),
      q: Clamp.bandLtQ(filter.q),
      gain: Clamp.bandLtFreqHz(filter.gain),
      qp: Clamp.bandLtQ(filter.qp ?? QP_DEFAULT),
    };
  }
  return {
    ...filter,
    frequency: Clamp.bandFrequencyHz(filter.frequency),
    q: Clamp.bandQ(filter.q),
    gain: Clamp.bandGainDb(filter.gain),
  };
}

export function setEqFilter(s: ReadySession, channel: ChannelId, band: number, filter: FilterParams): void {
  const ch = s.mirror.snapshot.channels.find((c) => c.id === channel);
  if (!ch) return;
  if (band >= ch.filters.length) {
    throw new Error(`band ${band} out of range for channel ${channel}`);
  }
  const clamped = clampFilter(filter);
  void write(s,
    () => s.device.setFilter(channel, band, clamped),
    () => {
      const c = s.mirror.snapshot.channels.find((c) => c.id === channel);
      // setFilter's wire command carries no bypass byte; keep the mirror's
      // live value so a concurrent setBandBypass ack is never clobbered.
      if (c) c.filters[band] = { ...clamped, bypass: c.filters[band].bypass };
    },
  );
}

// Copy all bands from source channel onto target channel as N independent granular writes.
export function copyEqBands(s: ReadySession, sourceId: ChannelId, targetId: ChannelId): void {
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

export function setBypass(s: ReadySession, enabled: boolean): void {
  void write(s,
    () => s.device.setBypass(enabled),
    () => { s.mirror.snapshot.bypass = enabled; },
  );
}

// Clears firmware-side latched clip flags (0x83) and the host-side OR-latch.
// Not routed through write/scrub: clip state lives in telemetry, not the DSP
// snapshot, so the post-send resync would be pure overhead. On send failure the
// host array stays cleared; the next poll re-latches from clipFlags if firmware
// still sees the condition.
export function clearClips(s: ReadySession): void {
  for (let i = 0; i < s.telemetry.clipLatched.length; i++) s.telemetry.clipLatched[i] = false;
  void s.queue.run(() => s.device.clearClips()).catch((e) => Log.error('clearClips', 'send failed', e));
}

// Empty / whitespace-only input clears the custom name on the device; the
// snapshot mirrors that by falling back to defaultName.
export function setChannelName(s: ReadySession, id: ChannelId, name: string): void {
  const ch = s.mirror.snapshot.channels.find((c) => c.id === id);
  if (!ch) return;
  const resolved = name.trim() || ch.defaultName;
  const clamped = Clamp.nameToByteBudget(resolved, CHANNEL_NAME_MAX_LEN);
  void write(s,
    () => s.device.setChannelName(id, clamped),
    () => {
      const c = s.mirror.snapshot.channels.find((c) => c.id === id);
      if (c) c.name = clamped;
    },
  );
}

export function setLoudnessEnabled(s: ReadySession, enabled: boolean): void {
  void write(s,
    () => s.device.setLoudnessEnabled(enabled),
    () => { s.mirror.snapshot.loudness.enabled = enabled; },
  );
}

export function setLoudnessRefSpl(s: ReadySession, db: number): void {
  db = Clamp.loudnessRefSpl(db);
  scrub(s,
    'loudnessRefSpl',
    () => { s.mirror.snapshot.loudness.refSpl = db; },
    () => s.device.setLoudnessRefSpl(db),
  );
}

export function setLoudnessIntensityPct(s: ReadySession, pct: number): void {
  pct = Clamp.loudnessIntensityPct(pct);
  scrub(s,
    'loudnessIntensity',
    () => { s.mirror.snapshot.loudness.intensityPct = pct; },
    () => s.device.setLoudnessIntensity(pct),
  );
}

// Per-output loudness mask (fw V19+): a single-channel toggle reads the
// current mask from the mirror, flips one bit, and re-sends the whole mask.
// Discrete edit -> write lane.
export function setLoudnessOutputMask(s: ReadySession, mask: number): void {
  mask &= 0xFFFF;
  void write(s,
    () => s.device.setLoudnessOutputMask(mask),
    () => { s.mirror.snapshot.loudness.outputMask = mask; },
  );
}

export function toggleLoudnessOutputChannel(s: ReadySession, ch: number): void {
  const mask = s.mirror.snapshot.loudness.outputMask ^ (1 << ch);
  setLoudnessOutputMask(s, mask);
}

export function setCrossfeedEnabled(s: ReadySession, enabled: boolean): void {
  void write(s,
    () => s.device.setCrossfeedEnabled(enabled),
    () => { s.mirror.snapshot.crossfeed.enabled = enabled; },
  );
}

export function setCrossfeedPreset(s: ReadySession, preset: CrossfeedPreset): void {
  void write(s,
    () => s.device.setCrossfeedPreset(preset),
    () => { s.mirror.snapshot.crossfeed.preset = preset; },
  );
}

export function setCrossfeedItd(s: ReadySession, itd: boolean): void {
  void write(s,
    () => s.device.setCrossfeedItd(itd),
    () => { s.mirror.snapshot.crossfeed.itd = itd; },
  );
}

export function setCrossfeedFreq(s: ReadySession, hz: number): void {
  hz = Clamp.crossfeedFreqHz(hz);
  scrub(s,
    'crossfeedFreq',
    () => { s.mirror.snapshot.crossfeed.freq = hz; },
    () => s.device.setCrossfeedFreq(hz),
  );
}

export function setCrossfeedFeedDb(s: ReadySession, db: number): void {
  db = Clamp.crossfeedFeedDb(db);
  scrub(s,
    'crossfeedFeedDb',
    () => { s.mirror.snapshot.crossfeed.feedDb = db; },
    () => s.device.setCrossfeedFeedDb(db),
  );
}

// Crossfeed output-pair mask (fw V20+): same single-command toggle pattern as
// the loudness output mask above. Discrete edit -> write lane.
export function setCrossfeedOutputPairs(s: ReadySession, mask: number): void {
  mask &= 0xFF;
  void write(s,
    () => s.device.setCrossfeedOutputPairs(mask),
    () => { s.mirror.snapshot.crossfeed.outputPairMask = mask; },
  );
}

export function toggleCrossfeedOutputPair(s: ReadySession, pair: number): void {
  const mask = s.mirror.snapshot.crossfeed.outputPairMask ^ (1 << pair);
  setCrossfeedOutputPairs(s, mask);
}

export function setLevellerEnabled(s: ReadySession, enabled: boolean): void {
  void write(s,
    () => s.device.setLevellerEnabled(enabled),
    () => { s.mirror.snapshot.leveller.enabled = enabled; },
  );
}

export function setLevellerSpeed(s: ReadySession, speed: LevellerSpeed): void {
  void write(s,
    () => s.device.setLevellerSpeed(speed),
    () => { s.mirror.snapshot.leveller.speed = speed; },
  );
}

export function setLevellerLookahead(s: ReadySession, lookahead: boolean): void {
  void write(s,
    () => s.device.setLevellerLookahead(lookahead),
    () => { s.mirror.snapshot.leveller.lookahead = lookahead; },
  );
}

export function setLevellerAmount(s: ReadySession, pct: number): void {
  pct = Clamp.levellerAmountPct(pct);
  scrub(s,
    'levellerAmount',
    () => { s.mirror.snapshot.leveller.amount = pct; },
    () => s.device.setLevellerAmount(pct),
  );
}

export function setLevellerMaxGain(s: ReadySession, db: number): void {
  db = Clamp.levellerMaxGainDb(db);
  scrub(s,
    'levellerMaxGain',
    () => { s.mirror.snapshot.leveller.maxGainDb = db; },
    () => s.device.setLevellerMaxGain(db),
  );
}

export function setLevellerGate(s: ReadySession, db: number): void {
  db = Clamp.levellerGateDb(db);
  scrub(s,
    'levellerGate',
    () => { s.mirror.snapshot.leveller.gateDb = db; },
    () => s.device.setLevellerGate(db),
  );
}

export function setPsybassEnabled(s: ReadySession, enabled: boolean): void {
  void write(s,
    () => s.device.setPsybassEnabled(enabled),
    () => { s.mirror.snapshot.psybass.enabled = enabled; },
  );
}

export function setPsybassCutoff(s: ReadySession, hz: number): void {
  hz = Clamp.psybassCutoffHz(hz);
  scrub(s,
    'psybassCutoff',
    () => { s.mirror.snapshot.psybass.cutoffHz = hz; },
    () => s.device.setPsybassCutoff(hz),
  );
}

export function setPsybassHarmonics(s: ReadySession, db: number): void {
  db = Clamp.psybassHarmonicsDb(db);
  scrub(s,
    'psybassHarmonics',
    () => { s.mirror.snapshot.psybass.harmonicsDb = db; },
    () => s.device.setPsybassHarmonics(db),
  );
}

export function setPsybassDrive(s: ReadySession, db: number): void {
  db = Clamp.psybassDriveDb(db);
  scrub(s,
    'psybassDrive',
    () => { s.mirror.snapshot.psybass.driveDb = db; },
    () => s.device.setPsybassDrive(db),
  );
}

export function setPsybassCharacter(s: ReadySession, pct: number): void {
  pct = Clamp.psybassCharacterPct(pct);
  scrub(s,
    'psybassCharacter',
    () => { s.mirror.snapshot.psybass.characterPct = pct; },
    () => s.device.setPsybassCharacter(pct),
  );
}

export function setPsybassOriginal(s: ReadySession, db: number): void {
  db = Clamp.psybassOriginalDb(db);
  scrub(s,
    'psybassOriginal',
    () => { s.mirror.snapshot.psybass.originalDb = db; },
    () => s.device.setPsybassOriginal(db),
  );
}

// Per-output psybass mask (fw V23+): same single-command toggle pattern as
// the loudness/crossfeed masks above. Discrete edit -> write lane.
export function setPsybassOutputMask(s: ReadySession, mask: number): void {
  mask &= 0xFFFF;
  void write(s,
    () => s.device.setPsybassMask(mask),
    () => { s.mirror.snapshot.psybass.outputMask = mask; },
  );
}

export function togglePsybassOutputChannel(s: ReadySession, ch: number): void {
  const mask = s.mirror.snapshot.psybass.outputMask ^ (1 << ch);
  setPsybassOutputMask(s, mask);
}

// Stereo upmixer (fw V25+, RP2350 only). Discrete mode/enable edits use the
// write lane; continuous knobs scrub, one lane key each.
export function setUpmixEnabled(s: ReadySession, enabled: boolean): void {
  void write(s,
    () => s.device.setUpmixEnabled(enabled),
    () => { s.mirror.snapshot.upmix.enabled = enabled; },
  );
}

export function setUpmixCenterMode(s: ReadySession, mode: number): void {
  void write(s,
    () => s.device.setUpmixCenterMode(mode),
    () => { s.mirror.snapshot.upmix.centerMode = mode; },
  );
}

export function setUpmixSurroundMode(s: ReadySession, mode: number): void {
  void write(s,
    () => s.device.setUpmixSurroundMode(mode),
    () => { s.mirror.snapshot.upmix.surroundMode = mode; },
  );
}

export function setUpmixStrength(s: ReadySession, pct: number): void {
  pct = Clamp.upmixStrengthPct(pct);
  scrub(s,
    'upmixStrength',
    () => { s.mirror.snapshot.upmix.strengthPct = pct; },
    () => s.device.setUpmixStrength(pct),
  );
}

export function setUpmixCenterWidth(s: ReadySession, pct: number): void {
  pct = Clamp.upmixCenterWidthPct(pct);
  scrub(s,
    'upmixCenterWidth',
    () => { s.mirror.snapshot.upmix.centerWidthPct = pct; },
    () => s.device.setUpmixCenterWidth(pct),
  );
}

export function setUpmixCorrThreshold(s: ReadySession, pct: number): void {
  pct = Clamp.upmixCorrThresholdPct(pct);
  scrub(s,
    'upmixCorrThreshold',
    () => { s.mirror.snapshot.upmix.corrThresholdPct = pct; },
    () => s.device.setUpmixCorrThreshold(pct),
  );
}

export function setUpmixAttack(s: ReadySession, ms: number): void {
  ms = Clamp.upmixAttackMs(ms);
  scrub(s,
    'upmixAttack',
    () => { s.mirror.snapshot.upmix.attackMs = ms; },
    () => s.device.setUpmixAttack(ms),
  );
}

export function setUpmixRelease(s: ReadySession, ms: number): void {
  ms = Clamp.upmixReleaseMs(ms);
  scrub(s,
    'upmixRelease',
    () => { s.mirror.snapshot.upmix.releaseMs = ms; },
    () => s.device.setUpmixRelease(ms),
  );
}

export function setUpmixDetectorHpf(s: ReadySession, hz: number): void {
  hz = Clamp.upmixDetectorHpfHz(hz);
  scrub(s,
    'upmixDetectorHpf',
    () => { s.mirror.snapshot.upmix.detectorHpfHz = hz; },
    () => s.device.setUpmixDetectorHpf(hz),
  );
}

export function setUpmixSurroundDelay(s: ReadySession, ms: number): void {
  ms = Clamp.upmixSurroundDelayMs(ms);
  scrub(s,
    'upmixSurroundDelay',
    () => { s.mirror.snapshot.upmix.surroundDelayMs = ms; },
    () => s.device.setUpmixSurroundDelay(ms),
  );
}

export function setUpmixSurroundHpf(s: ReadySession, hz: number): void {
  hz = Clamp.upmixSurroundHpfHz(hz);
  scrub(s,
    'upmixSurroundHpf',
    () => { s.mirror.snapshot.upmix.surroundHpfHz = hz; },
    () => s.device.setUpmixSurroundHpf(hz),
  );
}

export function setUpmixSurroundLpf(s: ReadySession, hz: number): void {
  hz = Clamp.upmixSurroundLpfHz(hz);
  scrub(s,
    'upmixSurroundLpf',
    () => { s.mirror.snapshot.upmix.surroundLpfHz = hz; },
    () => s.device.setUpmixSurroundLpf(hz),
  );
}

export function setUpmixDecorr(s: ReadySession, pct: number): void {
  pct = Clamp.upmixDecorrPct(pct);
  scrub(s,
    'upmixDecorr',
    () => { s.mirror.snapshot.upmix.decorrPct = pct; },
    () => s.device.setUpmixDecorr(pct),
  );
}

export function setUpmixPresence(s: ReadySession, db: number): void {
  db = Clamp.upmixPresenceDb(db);
  scrub(s,
    'upmixPresence',
    () => { s.mirror.snapshot.upmix.presenceDb = db; },
    () => s.device.setUpmixPresence(db),
  );
}

// Multichannel leveller masks (fw V18+): both masks travel together in one
// command, so a single-channel toggle reads the current pair from the mirror,
// flips one bit, and re-sends both. Discrete edit -> write lane.
export function setLevellerMasks(s: ReadySession, detector: number, apply: number): void {
  detector &= 0xFF;
  apply &= 0xFF;
  void write(s,
    () => s.device.setLevellerMasks(detector, apply),
    () => {
      s.mirror.snapshot.leveller.detectorMask = detector;
      s.mirror.snapshot.leveller.applyMask = apply;
    },
  );
}

export function toggleLevellerDetectorChannel(s: ReadySession, ch: number): void {
  const detector = s.mirror.snapshot.leveller.detectorMask ^ (1 << ch);
  setLevellerMasks(s, detector, s.mirror.snapshot.leveller.applyMask);
}

export function toggleLevellerApplyChannel(s: ReadySession, ch: number): void {
  const apply = s.mirror.snapshot.leveller.applyMask ^ (1 << ch);
  setLevellerMasks(s, s.mirror.snapshot.leveller.detectorMask, apply);
}

export function setMasterPreamp(s: ReadySession, db: number): void {
  db = Clamp.preampDb(db);
  scrub(s,
    'masterPreamp',
    () => { s.mirror.snapshot.masterPreampDb = db; },
    () => s.device.setMasterPreamp(db),
  );
}

export function setInputPreamp(s: ReadySession, channel: InputSlot, db: number): void {
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
  input: InputSlot,
  output: OutputSlot,
  mutate: (r: RouteModel) => RouteModel,
): void {
  const route = focusRoute(s, input, output);
  const next = mutate(route.read());
  void write(s,
    () => s.device.setMatrixRoute(input, output, { enabled: next.enabled, invert: next.invert, gainDb: next.gainDb }),
    () => route.modify(() => next),
  );
}

export function setCrosspointGain(s: ReadySession, input: InputSlot, output: OutputSlot, gainDb: number): void {
  gainDb = Clamp.crosspointGainDb(gainDb);
  scheduleCrosspointWrite(s, input, output, (r) => ({ ...r, gainDb }));
}

export function setCrosspointEnabled(s: ReadySession, input: InputSlot, output: OutputSlot, enabled: boolean): void {
  scheduleCrosspointWrite(s, input, output, (r) => ({ ...r, enabled }));
}

export function setCrosspointInvert(s: ReadySession, input: InputSlot, output: OutputSlot, invert: boolean): void {
  scheduleCrosspointWrite(s, input, output, (r) => ({ ...r, invert }));
}

// Click/commit-paced ValueField (no drag): plain write(), patch on ack. Scalar
// verb, no tuple to merge.
export function setOutputGain(s: ReadySession, slot: OutputSlot, gainDb: number): void {
  gainDb = Clamp.outputGainDb(gainDb);
  const out = focusOutput(s, slot);
  void write(s,
    () => s.device.setOutputGain(slot, gainDb),
    () => out.modify((o) => ({ ...o, gainDb })),
  );
}

export function setOutputDelay(s: ReadySession, slot: OutputSlot, delayMs: number): void {
  delayMs = Clamp.outputDelayMs(delayMs);
  void write(s,
    () => s.device.setOutputDelay(slot, delayMs),
    () => {
      const o = s.mirror.snapshot.outputs.find((o) => o.wireIndex === slot);
      if (o) o.delayMs = delayMs;
    },
  );
}

export function setOutputEnabled(s: ReadySession, slot: OutputSlot, enabled: boolean): void {
  void write(s,
    () => s.device.setOutputEnable(slot, enabled),
    () => {
      const o = s.mirror.snapshot.outputs.find((o) => o.wireIndex === slot);
      if (o) o.enabled = enabled;
    },
  );
}

// Both channels of a stereo pair, normalizing a half-enabled pair to a single
// state. Two independent write()s -- no tuple to merge, same as setOutputEnabled.
export function setOutputPairEnabled(s: ReadySession, pair: I2sPairSlot, enabled: boolean): void {
  setOutputEnabled(s, (pair * 2) as OutputSlot, enabled);
  setOutputEnabled(s, (pair * 2 + 1) as OutputSlot, enabled);
}

export function setOutputMuted(s: ReadySession, slot: OutputSlot, muted: boolean): void {
  void write(s,
    () => s.device.setOutputMute(slot, muted),
    () => {
      const o = s.mirror.snapshot.outputs.find((o) => o.wireIndex === slot);
      if (o) o.muted = muted;
    },
  );
}

export function setMasterVolume(s: ReadySession, db: number): void {
  db = Clamp.masterVolumeDb(db);
  scrub(s,
    'masterVolume',
    () => { s.mirror.snapshot.masterVolumeDb = db; },
    () => s.device.setMasterVolume(db),
  );
}

// Flips the firmware vendor user-mute bit (0xDC). The firmware ORs this with
// the UAC1 OS mute — they're independent; we reflect and control only this bit.
export function toggleMute(s: ReadySession): void {
  setUserMute(s, !s.mirror.snapshot.userVolume.mute);
}

export function setMasterVolumeMode(s: ReadySession, mode: MasterVolumeMode): void {
  void command(s,'set master volume mode', () => s.device.setMasterVolumeMode(mode), () => {
    if (s.presets.directory) s.presets.directory = { ...s.presets.directory, masterVolumeMode: mode };
  });
}

// 0xD6 SaveMasterVolume -- writes the directory's boot-baseline volume. In Mode 0
// this is the post-boot starting volume; in Mode 1 firmware accepts the call but
// it stays dormant until the user flips back to Mode 0. Fire-and-forget: only
// failure surfaces; success is silent (the Save button's state conveys it).
export function saveMasterVolumeBaseline(s: ReadySession): void {
  void command(s,'save master volume', () => s.device.saveMasterVolume(), (ok) => {
    if (!ok) { pushNotice('warn', 'Saving master volume failed (flash write error).'); return; }
    // Mirror the saved baseline so the Save button settles to clean without a refetch.
    s.presets.savedMasterVolumeDb = s.mirror.snapshot.masterVolumeDb;
  });
}

// 0x52 SaveOutputConfig -- persists the live physical-IO block (output pins,
// output types, I2S BCK/MCK, S/PDIF RX pin) to the directory's device-global
// block. Meaningful in Independent mode (the block is the boot source);
// firmware accepts it in WithPreset mode but it stays dormant. Fire-and-forget:
// only failure surfaces; success is silent (there is no saved-readback opcode,
// so no clean-detect).
export function saveOutputConfigBaseline(s: ReadySession): void {
  void command(s, 'save output config', () => s.device.saveOutputConfig(), (r) => {
    if (!r.ok) pushNotice('warn', `Saving output config failed (${r.message ?? 'flash error'}).`);
  });
}

// Discrete (commit-paced) config commands on the writeChecked() lane. Patching on
// ack (not before the send) keeps the mirror unchanged when the device rejects the
// command; the rejection surfaces as a warn toast and the background poll
// reconciles to committed truth. Never calls syncDeviceSnapshot (would discard
// unsaved EQ/mixer edits). setOutputType's SET is queued, not applied (the switch
// is deferred in firmware) -- the optimistic patch + reconcile converge to truth.

function patchI2s(s: ReadySession, update: (i: I2sConfig) => I2sConfig): void {
  s.mirror.snapshot.i2s = update(s.mirror.snapshot.i2s);
}

// A pin reset (0xFF sentinel) resolves to a real GPIO device-side, so there
// is nothing truthful to patch optimistically -- skip the patch and let the
// staged flow's eager reconcile bring back the resolved pin (a mirrored
// sentinel would briefly render as GP255).
function unlessPinReset(pin: number, patch: () => void): () => void {
  return () => { if (pin !== Wire.Const.PIN_RESET_TO_DEFAULT) patch(); };
}

function patchOutputPin(s: ReadySession, index: number, pin: number): void {
  const pins = s.mirror.snapshot.outputPins.slice();
  pins[index] = pin;
  s.mirror.snapshot.outputPins = pins;
}

export function setOutputDataPin(s: ReadySession, pinOutputIndex: number, pin: number): Promise<boolean> {
  return writeChecked(s,
    'set output pin',
    () => s.device.setOutputPin(pinOutputIndex, pin),
    unlessPinReset(pin, () => patchOutputPin(s, pinOutputIndex, pin)),
  );
}

export function setOutputType(s: ReadySession, slot: I2sPairSlot, type: number): Promise<boolean> {
  return writeChecked(s,
    'switch output type',
    () => s.device.setOutputType(slot, type),
    () => patchI2s(s, (i) => ({
      ...i,
      outputSlotTypes: i.outputSlotTypes.map((x, j) => (j === slot ? type : x)) as [number, number, number, number],
    })),
  );
}

export function setI2sBckPin(s: ReadySession, pin: number): Promise<boolean> {
  return writeChecked(s,'set I2S BCK pin', () => s.device.setI2sBckPin(pin), unlessPinReset(pin, () => patchI2s(s, (i) => ({ ...i, bckPin: pin }))));
}

export function setMckEnabled(s: ReadySession, on: boolean): Promise<boolean> {
  return writeChecked(s,'set MCK enable', () => s.device.setMckEnable(on), () => patchI2s(s, (i) => ({ ...i, mckEnabled: on })));
}

export function setMckPin(s: ReadySession, pin: number): Promise<boolean> {
  return writeChecked(s,'set MCK pin', () => s.device.setMckPin(pin), unlessPinReset(pin, () => patchI2s(s, (i) => ({ ...i, mckPin: pin }))));
}

export function setMckMultiplier(s: ReadySession, encoded: number): Promise<boolean> {
  return writeChecked(s,'set MCK multiplier', () => s.device.setMckMultiplier(encoded), () => patchI2s(s, (i) => ({ ...i, mckMultiplierEncoded: encoded })));
}

// I2S slave-clock role (fw V21+). Deferred apply on the device: patch the
// mirror optimistically once the SET acks, matching setInputSource's lane
// (no status byte to check).
export function setI2sClockMode(s: ReadySession, mode: number): Promise<boolean> {
  return write(s,
    () => s.device.setI2sClockMode(mode),
    () => { s.mirror.snapshot.inputConfig = { ...s.mirror.snapshot.inputConfig, i2sClockMode: mode }; },
  );
}

// BCK/LRCLK pin-sharing mode (fw V21+): 0 = unified, 1 = split.
export function setI2sClockPinMode(s: ReadySession, mode: number): Promise<boolean> {
  return writeChecked(s, 'set I2S clock pin mode', () => s.device.setI2sClockPinMode(mode), () => patchI2s(s, (i) => ({ ...i, clockPinMode: mode })));
}

// Slave-mode BCK pin (fw V21+, role 1). LRCLK rides pin+1 on the device side.
export function setI2sBckPinSlave(s: ReadySession, pin: number): Promise<boolean> {
  return writeChecked(s, 'set I2S BCK pin (slave)', () => s.device.setI2sBckPin(pin, 1), unlessPinReset(pin, () => patchI2s(s, (i) => ({ ...i, bckPinSlave: pin }))));
}

export function setUserMute(s: ReadySession, mute: boolean): void {
  void write(s,
    () => s.device.setUserMute(mute),
    () => { s.mirror.snapshot.userVolume.mute = mute; },
  );
}

// M3 — Per-band EQ bypass. Band edits flow through write() (await-then-patch),
// matching setEqFilter's lane. setFilter does not carry bypass, so bypass is
// a separate granular command.

export function setBandBypass(s: ReadySession, channel: ChannelId, band: number, bypassed: boolean): void {
  const ch = s.mirror.snapshot.channels.find((c) => c.id === channel);
  if (!ch || band >= ch.filters.length) return;
  void write(s,
    () => s.device.setBandBypass(channel, band, bypassed),
    () => {
      const c = s.mirror.snapshot.channels.find((c) => c.id === channel);
      if (c && c.filters[band]) c.filters[band] = { ...c.filters[band], bypass: bypassed };
    },
  );
}

// Crossover bands (V16+, output channels only). Same lane as the PEQ verbs;
// the device wrapper owns the 20..23 wire band-index offset. Q and gain are
// unused by crossover types but ride the packet for wire parity.
export function setXoverBand(s: ReadySession, channel: ChannelId, band: number, filter: FilterParams): void {
  const ch = s.mirror.snapshot.channels.find((c) => c.id === channel);
  if (!ch || band >= ch.xoverBands.length) return;
  const clamped: FilterParams = { ...filter, frequency: Clamp.bandFrequencyHz(filter.frequency) };
  void write(s,
    () => s.device.setCrossoverBand(channel, band, clamped),
    () => {
      const c = s.mirror.snapshot.channels.find((c) => c.id === channel);
      if (c) c.xoverBands[band] = { ...clamped, bypass: c.xoverBands[band].bypass };
    },
  );
}

export function setXoverBypass(s: ReadySession, channel: ChannelId, band: number, bypassed: boolean): void {
  const ch = s.mirror.snapshot.channels.find((c) => c.id === channel);
  if (!ch || band >= ch.xoverBands.length) return;
  void write(s,
    () => s.device.setCrossoverBypass(channel, band, bypassed),
    () => {
      const c = s.mirror.snapshot.channels.find((c) => c.id === channel);
      if (c && c.xoverBands[band]) c.xoverBands[band] = { ...c.xoverBands[band], bypass: bypassed };
    },
  );
}

// M1 — Input source switch. Pipeline reset is audible; surface an info notice
// only once the device acked. The retained RX status frame belongs to the
// previous source epoch -- drop it so a SPDIF re-entry can't show a stale lock.
export function setInputSource(s: ReadySession, source: AudioInputSource): Promise<boolean> {
  return write(s,
    () => s.device.setInputSource(source),
    () => {
      s.mirror.snapshot.inputConfig.source = source;
      s.telemetry.spdifRxStatus = null;
      pushNotice('info', 'Input source changed — firmware pipeline reset (brief audio mute).');
    },
  );
}

// M1 — S/PDIF RX pin. Action-style: status byte on rejection.
export function setSpdifRxPin(s: ReadySession, gpio: number): Promise<boolean> {
  return writeChecked(s,
    'set S/PDIF RX pin',
    () => s.device.setSpdifRxPin(gpio),
    unlessPinReset(gpio, () => { s.mirror.snapshot.inputConfig.spdifRxPin = gpio; }),
  );
}

// fw 1.1.5+ — RX pin for optional S/PDIF input 2/3. extIndex 0 = input 2
// (device instance 1), extIndex 1 = input 3 (device instance 2).
export function setSpdifRxPinExt(s: ReadySession, extIndex: number, gpio: number): Promise<boolean> {
  return writeChecked(s,
    'set S/PDIF RX pin',
    () => s.device.setSpdifRxPin(gpio, extIndex + 1),
    unlessPinReset(gpio, () => { s.mirror.snapshot.inputConfig.spdifRxPinExt[extIndex] = gpio; }),
  );
}

// fw 1.1.5+ — enable/disable optional S/PDIF input 2/3 (extIndex as above).
export function setSpdifInputEnabled(s: ReadySession, extIndex: number, on: boolean): Promise<boolean> {
  return writeChecked(s,
    'set S/PDIF input enable',
    () => s.device.setSpdifInputEnabled(extIndex + 1, on),
    () => { s.mirror.snapshot.inputConfig.spdifExtEnabled[extIndex] = on; },
  );
}

// V16 — I2S input rate. The device is the rate authority in I2S mode; when
// I2S is the active source firmware applies the change deferred (audible
// pipeline reset), otherwise it just stores the selection.
export function setInputRate(s: ReadySession, hz: number): Promise<boolean> {
  return write(s,
    () => s.device.setInputRate(hz),
    () => {
      s.mirror.snapshot.inputConfig.i2sInputRateHz = hz;
      if (s.mirror.snapshot.inputConfig.source === AudioInputSource.I2s) {
        pushNotice('info', 'I2S input rate changed — firmware pipeline reset (brief audio mute).');
      }
    },
  );
}

// V16 — I2S RX data pin per stereo pair. Action-style status byte covers
// invalid GPIO, clock/peripheral clash, or a pin already on another pair.
export function setI2sRxPin(s: ReadySession, pair: number, gpio: number): Promise<boolean> {
  return writeChecked(s,
    'set I2S RX pin',
    () => s.device.setI2sRxPin(pair, gpio),
    unlessPinReset(gpio, () => {
      const pins = s.mirror.snapshot.inputConfig.i2sRxPins.slice();
      pins[pair] = gpio;
      s.mirror.snapshot.inputConfig.i2sRxPins = pins;
    }),
  );
}

// V16 — active I2S input channel count (2/4/6/8, RP2350). The live count in
// telemetry updates via the INPUT_FORMAT notify when I2S is active.
export function setI2sInputChannels(s: ReadySession, count: number): Promise<boolean> {
  return writeChecked(s,
    'set I2S input channels',
    () => s.device.setI2sInputChannels(count),
    () => { s.mirror.snapshot.inputConfig.i2sInputChannels = count; },
  );
}

// V16 — external control interfaces (UART / I2C). The SET's result is only
// known from the device's read-back status (see DspDevice.setUartControlConfig),
// so this can't be a plain writeChecked: the status must land in ctrlIfaces
// on BOTH branches (a rejected pin/baud is still useful to show as
// last-status text), whereas writeChecked's patch only runs on ok.
export function setUartControlConfig(s: ReadySession, cfg: UartControlConfig): void {
  void command(s, 'set UART control config',
    () => s.device.setUartControlConfig(cfg),
    (r, s) => {
      s.ctrlIfaces.status = r.status;
      if (!r.result.ok) { pushNotice('warn', r.result.message); return; }
      s.ctrlIfaces.uart = cfg;
    },
  );
}

export function setI2cControlConfig(s: ReadySession, cfg: I2cControlConfig): void {
  void command(s, 'set I2C control config',
    () => s.device.setI2cControlConfig(cfg),
    (r, s) => {
      s.ctrlIfaces.status = r.status;
      if (!r.result.ok) { pushNotice('warn', r.result.message); return; }
      s.ctrlIfaces.i2c = cfg;
    },
  );
}

// V16 — Control Surfaces binding apply (0x84 + status poll). Immediate lane
// like the UART/I2C config above: a binding apply never restarts the audio
// path, so it bypasses the staged-apply gate. The polled status read-back
// must land in state on BOTH branches (a rejection is exactly what the panel
// needs to show), and the slot's live binding is re-read regardless of
// outcome -- on failure the firmware keeps and reports the previous one.
// Resolves true only when the device accepted the binding.
export async function applyCsBinding(s: ReadySession, slot: number, binding: CsBinding): Promise<boolean> {
  let ok = false;
  await command(s, 'set control-surface binding',
    async () => {
      const r = await s.device.setCsBinding(slot, binding);
      const live = await s.device.getCsBinding(slot);
      return { result: r.result, status: r.status, live };
    },
    (r, s) => {
      s.controlSurfaces.status = r.status;
      s.controlSurfaces.bindings[slot] = r.live.type === CsType.None ? null : r.live;
      if (!r.result.ok) { pushNotice('warn', r.result.message); return; }
      ok = true;
    },
  );
  return ok;
}

export function clearCsBinding(s: ReadySession, slot: number): Promise<boolean> {
  return applyCsBinding(s, slot, EMPTY_CS_BINDING);
}

// V16 — Control Surfaces slot name (0x8B + status poll). Names are slot
// metadata independent of the binding, so this is its own deferred apply on
// the same shared status channel as the binding SET. Resolves true only when
// the device accepted the name.
export async function applyCsName(s: ReadySession, slot: number, name: string): Promise<boolean> {
  let ok = false;
  await command(s, 'set control-surface name',
    async () => {
      const r = await s.device.setCsName(slot, name);
      const live = await s.device.getCsName(slot);
      return { result: r.result, status: r.status, live };
    },
    (r, s) => {
      s.controlSurfaces.status = r.status;
      s.controlSurfaces.names[slot] = r.live;
      if (!r.result.ok) { pushNotice('warn', r.result.message); return; }
      ok = true;
    },
  );
  return ok;
}

// V16 — persist the whole live Control Surfaces preview (bindings + names) to
// flash and clear `dirty`. Resolves true only on success; failure (BUSY, a
// flash write error) surfaces as a warn toast and leaves the preview live.
export async function csSaveConfig(s: ReadySession): Promise<boolean> {
  let ok = false;
  await command(s, 'save control-surface config',
    () => s.device.csSave(),
    (r, s) => {
      s.controlSurfaces.status = r.status;
      if (!r.result.ok) { pushNotice('warn', r.result.message); return; }
      ok = true;
    },
  );
  return ok;
}

// V16 — discard the live Control Surfaces preview and re-apply the stored
// config. The device rewinds every slot's binding and name, and every IR
// command sub-slot, to what was last saved, so this re-fetches all of them
// (plus status) rather than trusting whatever the panel's local drafts were
// showing.
export async function csRevertConfig(s: ReadySession): Promise<boolean> {
  let ok = false;
  await command(s, 'revert control-surface config',
    async () => {
      const r = await s.device.csRevert();
      if (!r.result.ok) return { result: r.result, status: r.status, bindings: null, names: null, irCommands: null };
      const bindings: (CsBinding | null)[] = [];
      const names: string[] = [];
      for (let slot = 0; slot < r.status.maxBindings; slot++) {
        const b = await s.device.getCsBinding(slot);
        bindings.push(b.type === CsType.None ? null : b);
        names.push(await s.device.getCsName(slot));
      }
      const maxIrCommands = s.controlSurfaces.caps?.maxIrCommands ?? 0;
      let irCommands: (CsIrCommand | null)[] | null = null;
      if (maxIrCommands > 0) {
        irCommands = [];
        for (let sub = 0; sub < maxIrCommands; sub++) {
          const cmd = await s.device.getCsIrCmd(sub);
          irCommands.push(cmd.protocol === CsIrProto.None ? null : cmd);
        }
      }
      return { result: r.result, status: r.status, bindings, names, irCommands };
    },
    (r, s) => {
      s.controlSurfaces.status = r.status;
      if (r.bindings) s.controlSurfaces.bindings = r.bindings;
      if (r.names) s.controlSurfaces.names = r.names;
      if (r.irCommands) s.controlSurfaces.irCommands = r.irCommands;
      if (!r.result.ok) { pushNotice('warn', r.result.message); return; }
      ok = true;
    },
  );
  return ok;
}

// V16 — Control Surfaces IR command apply (0x8D + status poll, sub-slot
// encoded as 0x80 | sub in last_slot). Same shape as applyCsBinding: the
// polled status and the slot's live command land in state on both branches,
// resolving true only when the device accepted the command.
export async function applyCsIrCommand(s: ReadySession, sub: number, cmd: CsIrCommand): Promise<boolean> {
  let ok = false;
  await command(s, 'set control-surface IR command',
    async () => {
      const r = await s.device.setCsIrCmd(sub, cmd);
      const live = await s.device.getCsIrCmd(sub);
      return { result: r.result, status: r.status, live };
    },
    (r, s) => {
      s.controlSurfaces.status = r.status;
      s.controlSurfaces.irCommands[sub] = r.live.protocol === CsIrProto.None ? null : r.live;
      if (!r.result.ok) { pushNotice('warn', r.result.message); return; }
      ok = true;
    },
  );
  return ok;
}

export function clearCsIrCommand(s: ReadySession, sub: number): Promise<boolean> {
  return applyCsIrCommand(s, sub, EMPTY_CS_IR_COMMAND);
}

// V16 — arm the IR learn window (0x8F, wValue=1). Fails immediately (no
// status poll, no queued apply) with NO_IR when there is no live IR
// receiver; on success the sub-state moves to ARMED so the panel can show
// "listening" until the notify channel reports completion (see
// notifyChannel.ts's csIrLearn routing).
export async function csIrLearnArm(s: ReadySession): Promise<boolean> {
  // Drop any previous result synchronously, BEFORE the device round-trip:
  // the panel's completion effect runs during the await, and a stale
  // DONE/TIMEOUT would complete the new learn instantly with the old code.
  s.controlSurfaces.irLearn = null;
  let ok = false;
  await command(s, 'arm IR learn',
    () => s.device.csIrLearnArm(),
    (result, s) => {
      if (!result.ok) { pushNotice('warn', result.message); return; }
      s.controlSurfaces.irLearn = { state: CS_IR_LEARN_ARMED, protocol: CsIrProto.None, code: 0 };
      ok = true;
    },
  );
  return ok;
}

// V16 — cancel an armed IR learn (0x8F, wValue=0); pushes no notification,
// so the sub-state returns to idle locally rather than waiting on one.
export async function csIrLearnCancel(s: ReadySession): Promise<void> {
  await command(s, 'cancel IR learn',
    () => s.device.csIrLearnCancel(),
    (_result, s) => { s.controlSurfaces.irLearn = null; },
  );
}

// M7 — LG Sound Sync enable toggle.
export function setLgSoundSyncEnabled(s: ReadySession, enabled: boolean): void {
  void write(s,
    () => s.device.setLgSoundSyncEnabled(enabled),
    () => { s.mirror.snapshot.lgSoundSync.enabled = enabled; },
  );
}

// M6 — DAC HW mute config. The wire takes the whole struct, so the verb takes
// a partial and merges over the live mirror optimistically BEFORE sending:
// a second edit inside the first ack window then builds on the first instead
// of silently reverting it from a stale captured struct.
//
// The firmware applies the struct in a deferred handler that SWALLOWS
// validation failures (bad pin / collision / hold_ms out of [1,500]); its own
// contract says hosts must read the config back to learn the verdict. So the
// verb clamps the timings, waits out the deferred apply, reads the echo back
// as device truth, and warns when an enable didn't stick.
const DAC_HW_MUTE_APPLY_MS = 200;

export function setDacHwMute(s: ReadySession, patch: Partial<DacHwMute>): void {
  const merged = { ...s.mirror.snapshot.dacHwMute, ...patch };
  const next: DacHwMute = merged.enabled
    ? { ...merged, holdMs: Clamp.dacHwMuteHoldMs(merged.holdMs), releaseMs: Clamp.dacHwMuteReleaseMs(merged.releaseMs) }
    : merged;
  s.mirror.snapshot.dacHwMute = next;
  // queued: false -- the apply wait must not hold the session queue (it would
  // stall the status poll); each wire call queues itself and the wait sits
  // between them.
  void command(s, 'set DAC HW mute', async () => {
    await s.queue.run(() => s.device.setDacHwMute(next));
    await new Promise((r) => setTimeout(r, DAC_HW_MUTE_APPLY_MS));
    return s.queue.run(() => s.device.getDacHwMute());
  }, (echo, s) => {
    s.mirror.snapshot.dacHwMute = echo;
    if (next.enabled && (echo.enabled !== next.enabled || echo.pin !== next.pin)) {
      pushNotice('warn', 'DAC HW mute config rejected by the device (pin in use or invalid).');
    }
    s.mirror.requestReconcile(false);
  }, { queued: false });
}

// M6 — DAC HW mute test pulse (~1s). Fire-and-forget.
export function testDacHwMute(s: ReadySession): void {
  void s.queue.run(() => s.device.testDacHwMute()).catch((e) => { pushNotice('error', `DAC mute test failed: ${errMessage(e)}`); });
}

// M9 — Buffer stats reset.
export function resetBufferStats(s: ReadySession): void {
  void s.queue.run(() => s.device.resetBufferStats()).catch((e) => { pushNotice('error', `Buffer stats reset failed: ${errMessage(e)}`); });
}

// M8 — Enter UF2 bootloader. The device disconnects immediately (100 ms delay
// in firmware before reset_usb_boot). The transfer may throw as the device
// drops mid-response; that is expected and is treated as a normal disconnect.
export async function enterBootloader(s: ReadySession): Promise<void> {
  try {
    await s.queue.run(() => s.device.enterBootloader());
  } catch {
    // Device dropped during or after the command -- that's the expected path.
  }
  // The transport disconnect event fires naturally after the device reboots
  // and triggers normal disconnect flow via attachTransportListeners.
}
