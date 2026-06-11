import {
  type FilterParams,
  type ChannelId, type InputSlot, type OutputSlot, type I2sPairSlot,
  type RouteModel,
  type I2sConfig,
  type AudioInputSource,
  type DacHwMute,
  CrossfeedPreset, LevellerSpeed, MasterVolumeMode,
  CHANNEL_NAME_MAX_LEN,
} from '@/domain';
import * as Clamp from '@/domain/clamp';
import {
  type ReadySession,
  pushNotice,
} from '@/state';
import { Log } from '@/utils';
import { write, scrub, writeChecked, command } from './writes';
import { focusOutput, focusRoute } from './focus';

export function setEqFilter(s: ReadySession, channel: ChannelId, band: number, filter: FilterParams): void {
  const ch = s.mirror.snapshot.channels.find((c) => c.id === channel);
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
  void write(s,
    () => s.device.setFilter(channel, band, clamped),
    () => {
      const c = s.mirror.snapshot.channels.find((c) => c.id === channel);
      if (c) c.filters[band] = { ...clamped };
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
  const copied = src.filters.slice(0, len).map((f) => ({
    ...f,
    frequency: Clamp.bandFrequencyHz(f.frequency),
    q: Clamp.bandQ(f.q),
    gain: Clamp.bandGainDb(f.gain),
  }));
  for (let i = 0; i < len; i++) {
    const band = i;
    const filter = copied[i];
    void write(s,
      () => s.device.setFilter(targetId, band, filter),
      () => {
        const t = s.mirror.snapshot.channels.find((c) => c.id === targetId);
        if (t) t.filters[band] = { ...filter };
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
  void s.device.clearClips().catch((e) => Log.error('clearClips', 'send failed', e));
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
  const cur = s.mirror.snapshot.inputPreampDb;
  const next: [number, number] = [cur[0], cur[1]];
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
  const next = !(s.mirror.snapshot.userVolume?.mute ?? false);
  void write(s,
    () => s.device.setUserMute(next),
    () => { if (s.mirror.snapshot.userVolume) s.mirror.snapshot.userVolume.mute = next; },
  );
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

function patchOutputPin(s: ReadySession, index: number, pin: number): void {
  const pins = s.mirror.snapshot.outputPins.slice();
  pins[index] = pin;
  s.mirror.snapshot.outputPins = pins;
}

export function setOutputDataPin(s: ReadySession, pinOutputIndex: number, pin: number): void {
  void writeChecked(s,
    'set output pin',
    () => s.device.setOutputPin(pinOutputIndex, pin),
    () => patchOutputPin(s, pinOutputIndex, pin),
  );
}

export function setOutputType(s: ReadySession, slot: I2sPairSlot, type: number): void {
  void writeChecked(s,
    'switch output type',
    () => s.device.setOutputType(slot, type),
    () => patchI2s(s, (i) => ({
      ...i,
      outputSlotTypes: i.outputSlotTypes.map((x, j) => (j === slot ? type : x)) as [number, number, number, number],
    })),
  );
}

export function setI2sBckPin(s: ReadySession, pin: number): void {
  void writeChecked(s,'set I2S BCK pin', () => s.device.setI2sBckPin(pin), () => patchI2s(s, (i) => ({ ...i, bckPin: pin })));
}

export function setMckEnabled(s: ReadySession, on: boolean): void {
  void writeChecked(s,'set MCK enable', () => s.device.setMckEnable(on), () => patchI2s(s, (i) => ({ ...i, mckEnabled: on })));
}

export function setMckPin(s: ReadySession, pin: number): void {
  void writeChecked(s,'set MCK pin', () => s.device.setMckPin(pin), () => patchI2s(s, (i) => ({ ...i, mckPin: pin })));
}

export function setMckMultiplier(s: ReadySession, encoded: number): void {
  void writeChecked(s,'set MCK multiplier', () => s.device.setMckMultiplier(encoded), () => patchI2s(s, (i) => ({ ...i, mckMultiplierEncoded: encoded })));
}

export function setUserMute(s: ReadySession, mute: boolean): void {
  void write(s,
    () => s.device.setUserMute(mute),
    () => { if (s.mirror.snapshot.userVolume) s.mirror.snapshot.userVolume.mute = mute; },
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

// M1 — Input source switch. Pipeline reset is audible; surface an info notice.
export function setInputSource(s: ReadySession, source: AudioInputSource): void {
  void write(s,
    () => s.device.setInputSource(source),
    () => { if (s.mirror.snapshot.inputConfig) s.mirror.snapshot.inputConfig.source = source; },
  );
  pushNotice('info', 'Input source changed — firmware pipeline reset (brief audio mute).');
}

// M1 — S/PDIF RX pin. Action-style: status byte on rejection.
export function setSpdifRxPin(s: ReadySession, gpio: number): void {
  void writeChecked(s,
    'set S/PDIF RX pin',
    () => s.device.setSpdifRxPin(gpio),
    () => { if (s.mirror.snapshot.inputConfig) s.mirror.snapshot.inputConfig.spdifRxPin = gpio; },
  );
}

// M7 — LG Sound Sync enable toggle.
export function setLgSoundSyncEnabled(s: ReadySession, enabled: boolean): void {
  void write(s,
    () => s.device.setLgSoundSyncEnabled(enabled),
    () => { if (s.mirror.snapshot.lgSoundSync) s.mirror.snapshot.lgSoundSync.enabled = enabled; },
  );
}

// M6 — DAC HW mute config (whole-struct write, command lane).
export function setDacHwMute(s: ReadySession, cfg: DacHwMute): void {
  void command(s, 'set DAC HW mute', () => s.device.setDacHwMute(cfg), (_ok, s) => {
    if (s.mirror.snapshot.dacHwMute) s.mirror.snapshot.dacHwMute = { ...cfg };
    s.mirror.requestReconcile(false);
  });
}

// M6 — DAC HW mute test pulse (~1s). Fire-and-forget.
export function testDacHwMute(s: ReadySession): void {
  void s.device.testDacHwMute().catch((e) => { pushNotice('error', `DAC mute test failed: ${e instanceof Error ? e.message : String(e)}`); });
}

// M9 — Buffer stats reset.
export function resetBufferStats(s: ReadySession): void {
  void s.device.resetBufferStats().catch((e) => { pushNotice('error', `Buffer stats reset failed: ${e instanceof Error ? e.message : String(e)}`); });
}

// M8 — Enter UF2 bootloader. The device disconnects immediately (100 ms delay
// in firmware before reset_usb_boot). The transfer may throw as the device
// drops mid-response; that is expected and is treated as a normal disconnect.
export async function enterBootloader(s: ReadySession): Promise<void> {
  try {
    await s.device.enterBootloader();
  } catch {
    // Device dropped during or after the command -- that's the expected path.
  }
  // The transport disconnect event fires naturally after the device reboots
  // and triggers normal disconnect flow via attachTransportListeners.
}
