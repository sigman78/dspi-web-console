import {
  type FilterParams,
  type ChannelId, type InputSlot, type OutputSlot,
  type RouteModel, type OutputModel, type DspSnapshot,
  type I2sConfig,
  CrossfeedPreset, LevellerSpeed, MasterVolumeMode,
  CHANNEL_NAME_MAX_LEN,
} from '@/domain';
import * as Clamp from '@/domain/clamp';
import type { DspTransport } from '@/transport/DspTransport';
import type { DspDevice } from '@/device/DspDevice';
import {
  bindDevice, session, setStatus,
  presets,
  dsp, patchSnapshot, resetDsp,
  settings, reconcileEqTarget,
  resetStatus, status,
  clearCopySource,
} from '@/state';
import { Result, Log, type VoidResult } from '@/utils';
import { startPolling } from './poll';
import { connectionScope, endConnection } from './connectionScope';
import * as mirror from '@/state/mirror.svelte';
import { write, scrub, flushAllWrites, cancelAllWrites } from '@/device/writes';
import { focusOutput, focusRoute } from './focus';
import { fetchPresetInfo, invalidatePresetCache } from './presets';

const MUTE_DB = -128; // per spec

function _setMasterVolume(db: number): void {
  const d = session.device;
  if (!d) return;
  scrub(
    'masterVolume',
    () => patchSnapshot({ masterVolumeDb: db }),
    () => d.setMasterVolume(db),
  );
}

let inflightSync: Promise<void> | null = null;

export function setEqFilter(channel: ChannelId, band: number, filter: FilterParams): void {
  if (!dsp.draft?.channels) return;
  const ch = dsp.draft.channels.find((c) => c.id === channel);
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
      if (!dsp.draft) return;
      const c = dsp.draft.channels.find((c) => c.id === channel);
      if (c) c.filters[band] = { ...clamped };
    },
  );
}

// Copy all bands from source channel onto target channel as N independent granular writes.
export function copyEqBands(sourceId: ChannelId, targetId: ChannelId): void {
  if (sourceId === targetId || !dsp.draft?.channels) return;
  const src = dsp.draft.channels.find((c) => c.id === sourceId);
  const tgt = dsp.draft.channels.find((c) => c.id === targetId);
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
        if (!dsp.draft) return;
        const t = dsp.draft.channels.find((c) => c.id === targetId);
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
    () => patchSnapshot({ bypass: enabled }),
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
  if (!dsp.draft?.channels) return;
  const ch = dsp.draft.channels.find((c) => c.id === id);
  if (!ch) return;
  const resolved = name.trim() || ch.defaultName;
  const clamped = Clamp.nameToByteBudget(resolved, CHANNEL_NAME_MAX_LEN);
  const d = session.device;
  if (!d) return;
  void write(
    () => d.setChannelName(id, clamped),
    () => {
      if (!dsp.draft) return;
      const c = dsp.draft.channels.find((c) => c.id === id);
      if (c) c.name = clamped;
      const o = dsp.draft.outputs.find((o) => o.id === id);
      if (o) o.name = clamped;
    },
  );
}

export function setLoudnessEnabled(enabled: boolean): void {
  const d = session.device;
  if (!d) return;
  void write(
    () => d.setLoudnessEnabled(enabled),
    () => { if (dsp.draft) dsp.draft.loudness.enabled = enabled; },
  );
}

export function setLoudnessRefSpl(db: number): void {
  db = Clamp.loudnessRefSpl(db);
  const d = session.device;
  if (!d) return;
  scrub(
    'loudnessRefSpl',
    () => { if (dsp.draft) dsp.draft.loudness.refSpl = db; },
    () => d.setLoudnessRefSpl(db),
  );
}

export function setLoudnessIntensityPct(pct: number): void {
  pct = Clamp.loudnessIntensityPct(pct);
  const d = session.device;
  if (!d) return;
  scrub(
    'loudnessIntensity',
    () => { if (dsp.draft) dsp.draft.loudness.intensityPct = pct; },
    () => d.setLoudnessIntensity(pct),
  );
}

export function setCrossfeedEnabled(enabled: boolean): void {
  const d = session.device;
  if (!d) return;
  void write(
    () => d.setCrossfeedEnabled(enabled),
    () => { if (dsp.draft) dsp.draft.crossfeed.enabled = enabled; },
  );
}

export function setCrossfeedPreset(preset: CrossfeedPreset): void {
  const d = session.device;
  if (!d) return;
  void write(
    () => d.setCrossfeedPreset(preset),
    () => { if (dsp.draft) dsp.draft.crossfeed.preset = preset; },
  );
}

export function setCrossfeedItd(itd: boolean): void {
  const d = session.device;
  if (!d) return;
  void write(
    () => d.setCrossfeedItd(itd),
    () => { if (dsp.draft) dsp.draft.crossfeed.itd = itd; },
  );
}

export function setCrossfeedFreq(hz: number): void {
  hz = Clamp.crossfeedFreqHz(hz);
  const d = session.device;
  if (!d) return;
  scrub(
    'crossfeedFreq',
    () => { if (dsp.draft) dsp.draft.crossfeed.freq = hz; },
    () => d.setCrossfeedFreq(hz),
  );
}

export function setCrossfeedFeedDb(db: number): void {
  db = Clamp.crossfeedFeedDb(db);
  const d = session.device;
  if (!d) return;
  scrub(
    'crossfeedFeedDb',
    () => { if (dsp.draft) dsp.draft.crossfeed.feedDb = db; },
    () => d.setCrossfeedFeedDb(db),
  );
}

export function setLevellerEnabled(enabled: boolean): void {
  const d = session.device;
  if (!d) return;
  void write(
    () => d.setLevellerEnabled(enabled),
    () => { if (dsp.draft?.leveller) dsp.draft.leveller.enabled = enabled; },
  );
}

export function setLevellerSpeed(speed: LevellerSpeed): void {
  const d = session.device;
  if (!d) return;
  void write(
    () => d.setLevellerSpeed(speed),
    () => { if (dsp.draft?.leveller) dsp.draft.leveller.speed = speed; },
  );
}

export function setLevellerLookahead(lookahead: boolean): void {
  const d = session.device;
  if (!d) return;
  void write(
    () => d.setLevellerLookahead(lookahead),
    () => { if (dsp.draft?.leveller) dsp.draft.leveller.lookahead = lookahead; },
  );
}

export function setLevellerAmount(pct: number): void {
  pct = Clamp.levellerAmountPct(pct);
  const d = session.device;
  if (!d) return;
  scrub(
    'levellerAmount',
    () => { if (dsp.draft?.leveller) dsp.draft.leveller.amount = pct; },
    () => d.setLevellerAmount(pct),
  );
}

export function setLevellerMaxGain(db: number): void {
  db = Clamp.levellerMaxGainDb(db);
  const d = session.device;
  if (!d) return;
  scrub(
    'levellerMaxGain',
    () => { if (dsp.draft?.leveller) dsp.draft.leveller.maxGainDb = db; },
    () => d.setLevellerMaxGain(db),
  );
}

export function setLevellerGate(db: number): void {
  db = Clamp.levellerGateDb(db);
  const d = session.device;
  if (!d) return;
  scrub(
    'levellerGate',
    () => { if (dsp.draft?.leveller) dsp.draft.leveller.gateDb = db; },
    () => d.setLevellerGate(db),
  );
}

export function setMasterPreamp(db: number): void {
  db = Clamp.preampDb(db);
  const d = session.device;
  if (!d) return;
  scrub(
    'masterPreamp',
    () => patchSnapshot({ masterPreampDb: db }),
    () => d.setMasterPreamp(db),
  );
}

export function setInputPreamp(channel: InputSlot, db: number): void {
  db = Clamp.preampDb(db);
  const cur = dsp.draft?.inputPreampDb;
  if (!cur) return;
  const next: [number, number] = [cur[0], cur[1]];
  next[channel] = db;
  const d = session.device;
  if (!d) return;
  scrub(
    `inputPreamp:${channel}`,
    () => patchSnapshot({ inputPreampDb: next }),
    () => d.setInputPreamp(channel, db),
  );
}

// All three crosspoint mutations share one per-item granular lane keyed by the
// cell. Each send reads the full {enabled, invert, gainDb} tuple from `draft`
// and writes it via setMatrixRoute, so a toggle and a gain drag on the same
// cell coalesce into one consistent write. Per-item writes do not mute audio
// (unlike the bulk path), which is why crosspoint gain stays granular.
function scheduleCrosspointWrite(
  input: InputSlot,
  output: OutputSlot,
  mutate: (r: RouteModel) => RouteModel,
): void {
  if (!dsp.draft?.routes) return;
  const route = focusRoute(input, output);
  const d = session.device;
  if (!d) return;
  scrub(
    `crosspoint:${input}:${output}`,
    () => route.modify(mutate),
    async () => {
      const c = route.read();
      await d.setMatrixRoute(input, output, {
        enabled: c.enabled,
        invert: c.invert,
        gainDb: c.gainDb,
      });
    },
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

export function setOutputGain(slot: OutputSlot, gainDb: number): void {
  gainDb = Clamp.outputGainDb(gainDb);
  if (!dsp.draft?.outputs) return;
  const out = focusOutput(slot);
  const d = session.device;
  if (!d) return;
  scrub(
    `outputGain:${slot}`,
    () => out.modify((o) => ({ ...o, gainDb })),
    () => d.setOutputGain(slot, gainDb),
  );
}

// Write-path output addressing: locate the output by wire slot in the draft
// being mutated. A missing slot is a silent no-op.
export function setOutputDelay(slot: OutputSlot, delayMs: number): void {
  if (!dsp.draft?.outputs) return;
  delayMs = Clamp.outputDelayMs(delayMs);
  const d = session.device;
  if (!d) return;
  void write(
    () => d.setOutputDelay(slot, delayMs),
    () => {
      if (!dsp.draft) return;
      const o = dsp.draft.outputs.find((o) => o.wireIndex === slot);
      if (o) o.delayMs = delayMs;
    },
  );
}

export function setOutputEnabled(slot: OutputSlot, enabled: boolean): void {
  if (!dsp.draft?.outputs) return;
  const d = session.device;
  if (!d) return;
  void write(
    () => d.setOutputEnable(slot, enabled),
    () => {
      if (!dsp.draft) return;
      const o = dsp.draft.outputs.find((o) => o.wireIndex === slot);
      if (o) o.enabled = enabled;
    },
  );
}

export function setOutputMuted(slot: OutputSlot, muted: boolean): void {
  if (!dsp.draft?.outputs) return;
  const d = session.device;
  if (!d) return;
  void write(
    () => d.setOutputMute(slot, muted),
    () => {
      if (!dsp.draft) return;
      const o = dsp.draft.outputs.find((o) => o.wireIndex === slot);
      if (o) o.muted = muted;
    },
  );
}

export async function syncDeviceSnapshot(): Promise<void> {
  if (inflightSync) return inflightSync;
  const d = session.device;
  if (!d) throw new Error('No device');
  inflightSync = (async () => {
    try {
      const snap = await d.getSnapshot();
      mirror.init(snap);
    } catch (err) {
      Log.error('sync', 'syncDeviceSnapshot failed', err);
      setStatus('error', (err as Error).message);
      throw err;
    } finally {
      inflightSync = null;
    }
  })();
  return inflightSync;
}

export async function finishConnection(device: DspDevice): Promise<void> {
  if (session.device !== device) {
    throw new Error('Cannot finish connection for inactive device');
  }
  setStatus('connecting');
  try {
    await syncDeviceSnapshot();
    setStatus('connected');
    settings.lastSerial = device.info.serial;
    await reconcileAfterSync();
    // Production opens the scope in createBoundDevice; tests may call
    // finishConnection directly with no scope, so guard the registration.
    const s = connectionScope();
    if (s) {
      s.add(startPolling());
      s.add(() => cancelAllWrites());
    }
    await fetchPresetInfo();
    Log.info('sync', 'connected', {
      platform: dsp.draft?.platform.name,
      formatVersion: dsp.draft?.formatVersion,
      masterVolumeDb: dsp.draft?.masterVolumeDb,
    });
  } catch (err) {
    Log.error('sync', 'finishConnection failed', err);
    setStatus('error', (err as Error).message);
    throw err;
  }
}

// Re-apply UI policy that should outlive a (re)connect (mute, eqTarget).
// Runs after the snapshot is hydrated and the connection is marked
// connected, so it sees the freshly-synced device state and can write
// through it. reconcileEqTarget is a pure state-layer step that runs
// before the device-touching mute restore -- it doesn't need the device.
export async function reconcileAfterSync(): Promise<void> {
  reconcileEqTarget();
  const d = session.device;
  if (!d) return;
  if (settings.soft.muted) {
    const restoreFrom = settings.soft.mutedFromDb ?? dsp.draft?.masterVolumeDb ?? 0;
    settings.soft.mutedFromDb = restoreFrom;
    patchSnapshot({ masterVolumeDb: MUTE_DB });
    await d.setMasterVolume(MUTE_DB);
  }
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
    settings.soft.mutedFromDb = dsp.draft?.masterVolumeDb ?? 0;
    settings.soft.muted = true;
    _setMasterVolume(MUTE_DB);
  }
}

export function attachTransportListeners(transport: DspTransport): () => void {
  const offDisc = transport.on('disconnect', () => {
    // endConnection() disposes the scope, which removes THIS very listener
    // mid-emit (offDisc). Deleting the currently-firing entry from the
    // transport's listener Set during its forEach is safe — it won't be
    // revisited and won't throw.
    endConnection();                 // disposes commands, resync, poll loop, listeners
    bindDevice(null);
    setStatus('disconnected');
    resetDsp();
    invalidatePresetCache();
    clearCopySource();
    resetStatus();
  });
  const offConn = transport.on('connect', () => {
    const device = session.device;
    if (!device) return;
    void finishConnection(device).catch((e) => {
      Log.error('transport', 'auto-finish after connect failed', e);
      setStatus('error', (e as Error).message);
    });
  });
  return () => { offDisc(); offConn(); };
}

// Master-volume mode --------------------------------------------------------

export async function setMasterVolumeMode(mode: MasterVolumeMode): Promise<void> {
  const d = session.device; if (!d) return;
  await d.setMasterVolumeMode(mode);
  if (presets.directory) {
    presets.directory = { ...presets.directory, masterVolumeMode: mode };
  }
}

// 0xD6 SaveMasterVolume — writes the directory's boot-baseline volume.
// In Mode 0 this is the post-boot starting volume; in Mode 1 firmware
// accepts the call but it's dormant until the user flips back to Mode 0.
// Returns a Result so callers can show a success indicator.
export async function saveMasterVolumeBaseline(): Promise<VoidResult> {
  const d = session.device;
  if (!d) return Result.fail('no device', 'no device');
  const success = await d.saveMasterVolume();
  return success ? Result.ok() : Result.fail('write error', 'flash write error');
}

export async function factoryResetDevice(): Promise<VoidResult> {
  const d = session.device;
  if (!d) return Result.fail('no device', 'no device');
  // Drain any parked optimistic write so a pre-reset bulk send can't settle
  // mid-reset and re-push stale params (mirrors the preset load/paste flows).
  await flushAllWrites();
  const r = await d.factoryReset();
  // r.message is always present on the failure branch; map the typed flash
  // code to the action wrapper's string channel.
  if (!r.ok) return Result.fail('factory reset failed', r.message);
  invalidatePresetCache();
  clearCopySource();
  await syncDeviceSnapshot();
  return Result.ok();
}

// Output pin / I2S config verbs -------------------------------------------
// Direct-call pattern: call granular device method, await typed Result,
// do a targeted readback of only the affected field, and patchSnapshot
// with just that field. Never calls syncDeviceSnapshot (would discard
// unsaved EQ/mixer edits in dsp.draft).

const settle = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function patchI2s(update: (i: I2sConfig) => I2sConfig): void {
  if (dsp.draft?.i2s) patchSnapshot({ i2s: update(dsp.draft.i2s) });
}

export async function setOutputDataPin(pinOutputIndex: number, pin: number): Promise<VoidResult> {
  const d = session.device;
  if (!d) return Result.fail('no device', 'no device');
  await flushAllWrites();
  const r = await d.setOutputPin(pinOutputIndex, pin);
  if (!r.ok) return Result.fail('pin set failed', r.message);
  const actual = await d.getOutputPin(pinOutputIndex);
  if (dsp.draft) {
    const pins = dsp.draft.outputPins.slice();
    pins[pinOutputIndex] = actual;
    patchSnapshot({ outputPins: pins });
  }
  return Result.ok();
}

export async function setOutputType(slot: OutputSlot, type: number): Promise<VoidResult> {
  const d = session.device;
  if (!d) return Result.fail('no device', 'no device');
  if (!dsp.draft?.i2s) return Result.fail('no i2s', 'platform has no I2S config');
  await flushAllWrites();
  const r = await d.setOutputType(slot, type);
  if (!r.ok) return Result.fail('type switch failed', r.message);
  const applyType = (v: number) =>
    patchI2s((i) => ({
      ...i,
      outputSlotTypes: i.outputSlotTypes.map((x, j) => (j === slot ? v : x)) as [number, number, number, number],
    }));
  applyType(type);
  await settle(50);
  const actual = await d.getOutputType(slot);
  applyType(actual);
  return actual === type ? Result.ok() : Result.fail('type not applied', 'device did not switch type');
}

export async function setI2sBckPin(pin: number): Promise<VoidResult> {
  const d = session.device;
  if (!d) return Result.fail('no device', 'no device');
  if (!dsp.draft?.i2s) return Result.fail('no i2s', 'platform has no I2S config');
  await flushAllWrites();
  const r = await d.setI2sBckPin(pin);
  if (!r.ok) return Result.fail('bck set failed', r.message);
  const actual = await d.getI2sBckPin();
  patchI2s((i) => ({ ...i, bckPin: actual }));
  return Result.ok();
}

export async function setMckEnabled(on: boolean): Promise<VoidResult> {
  const d = session.device;
  if (!d) return Result.fail('no device', 'no device');
  if (!dsp.draft?.i2s) return Result.fail('no i2s', 'platform has no I2S config');
  await flushAllWrites();
  const r = await d.setMckEnable(on);
  if (!r.ok) return Result.fail('mck enable failed', r.message);
  const actual = await d.getMckEnable();
  patchI2s((i) => ({ ...i, mckEnabled: actual === 1 }));
  return Result.ok();
}

export async function setMckPin(pin: number): Promise<VoidResult> {
  const d = session.device;
  if (!d) return Result.fail('no device', 'no device');
  if (!dsp.draft?.i2s) return Result.fail('no i2s', 'platform has no I2S config');
  await flushAllWrites();
  const r = await d.setMckPin(pin);
  if (!r.ok) return Result.fail('mck pin failed', r.message);
  const actual = await d.getMckPin();
  patchI2s((i) => ({ ...i, mckPin: actual }));
  return Result.ok();
}

export async function setMckMultiplier(encoded: number): Promise<VoidResult> {
  const d = session.device;
  if (!d) return Result.fail('no device', 'no device');
  if (!dsp.draft?.i2s) return Result.fail('no i2s', 'platform has no I2S config');
  await flushAllWrites();
  const r = await d.setMckMultiplier(encoded);
  if (!r.ok) return Result.fail('mck multiplier failed', r.message);
  const actual = await d.getMckMultiplier();
  patchI2s((i) => ({ ...i, mckMultiplierEncoded: actual }));
  return Result.ok();
}
