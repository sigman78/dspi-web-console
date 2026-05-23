import {
  type FilterParams,
  type ChannelId, type InputSlot, type OutputSlot,
  type RouteModel,
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
import { cancelResync } from './resync';
import {
  enqueue, applyBaselineConverged,
  flush as flushPending, cancel as cancelAllCommands,
} from './outbox';
import { focusOutput, focusRoute } from './focus';
import { fetchPresetInfo, invalidatePresetCache } from './presets';

const MUTE_DB = -128; // per spec

function _setMasterVolume(db: number): void {
  enqueue({
    control: 'masterVolume',
    coalesceKey: 'masterVolume',
    apply: () => patchSnapshot({ masterVolumeDb: db }),
    send: (d) => d.setMasterVolume(db),
  });
}

let inflightSync: Promise<void> | null = null;

export function setEqFilter(channel: ChannelId, band: number, filter: FilterParams): void {
  if (!dsp.draft?.channels) return;
  const ch = dsp.draft.channels.find((c) => c.id === channel);
  if (!ch) return;
  if (band >= ch.filters.length) {
    throw new Error(`band ${band} out of range for channel ${channel}`);
  }
  enqueue({ control: 'eqFilter', mutate: (s) => {
    const c = s.channels.find((c) => c.id === channel)!;
    c.filters[band] = {
      ...filter,
      frequency: Clamp.bandFrequencyHz(filter.frequency),
      q: Clamp.bandQ(filter.q),
      gain: Clamp.bandGainDb(filter.gain),
    };
  } });
}

// Copy all bands from source channel onto target channel as a single
// bulk write. Under commitBulk, EQ edits no longer have per-band scrub
// lanes, so no cancelScrubLane calls are needed.
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
  enqueue({ control: 'eqFilter', mutate: (s) => {
    const t = s.channels.find((c) => c.id === targetId)!;
    for (let i = 0; i < len; i++) t.filters[i] = { ...copied[i] };
  } });
}

export function setBypass(enabled: boolean): void {
  enqueue({ control: 'bypass', mutate: (s) => { s.bypass = enabled; } });
}

// Telemetry-only action: clears firmware-side latched clip flags (0x83) and
// resets the host-side OR-latch (`status.clipLatched`). Not routed through
// the commit/scrub write path because clip state lives in telemetry, not the
// DSP snapshot, so the post-send bulk resync would be pure overhead. If the
// wire send fails, the host array stays cleared — the next poll cycle
// will re-latch from `clipFlags` if firmware still sees the condition.
export function clearClips(): void {
  const d = session.device;
  if (!d) return;
  for (let i = 0; i < status.clipLatched.length; i++) status.clipLatched[i] = false;
  void d.clearClips().catch((e) => Log.error('clearClips', 'send failed', e));
}

// Empty / whitespace-only input clears the custom name on the device; the
// optimistic snapshot mirrors that by falling back to defaultName, matching
// what `displayNameForChannel` produces after a bulk resync. The outputs[]
// name mirror keeps MatrixHeader and OverviewTab in sync without waiting
// for the trailing bulk resync.
export function setChannelName(id: ChannelId, name: string): void {
  if (!dsp.draft?.channels) return;
  const ch = dsp.draft.channels.find((c) => c.id === id);
  if (!ch) return;
  const resolved = name.trim() || ch.defaultName;
  const clamped = Clamp.nameToByteBudget(resolved, CHANNEL_NAME_MAX_LEN);
  enqueue({ control: 'channelName', mutate: (s) => {
    const c = s.channels.find((c) => c.id === id)!;
    c.name = clamped;
    const o = s.outputs.find((o) => o.id === id);
    if (o) o.name = clamped;
  } });
}

export function setLoudnessEnabled(enabled: boolean): void {
  enqueue({ control: 'loudnessEnabled', mutate: (s) => { s.loudness.enabled = enabled; } });
}

export function setLoudnessRefSpl(db: number): void {
  db = Clamp.loudnessRefSpl(db);
  enqueue({ control: 'loudnessRefSpl', debounceKey: 'loudnessRefSpl', mutate: (s) => { s.loudness.refSpl = db; } });
}

export function setLoudnessIntensityPct(pct: number): void {
  pct = Clamp.loudnessIntensityPct(pct);
  enqueue({ control: 'loudnessIntensity', debounceKey: 'loudnessIntensity', mutate: (s) => { s.loudness.intensityPct = pct; } });
}

export function setCrossfeedEnabled(enabled: boolean): void {
  enqueue({ control: 'crossfeedEnabled', mutate: (s) => { s.crossfeed.enabled = enabled; } });
}

export function setCrossfeedPreset(preset: CrossfeedPreset): void {
  enqueue({ control: 'crossfeedPreset', mutate: (s) => { s.crossfeed.preset = preset; } });
}

export function setCrossfeedItd(itd: boolean): void {
  enqueue({ control: 'crossfeedItd', mutate: (s) => { s.crossfeed.itd = itd; } });
}

export function setCrossfeedFreq(hz: number): void {
  hz = Clamp.crossfeedFreqHz(hz);
  enqueue({ control: 'crossfeedFreq', debounceKey: 'crossfeedFreq', mutate: (s) => { s.crossfeed.freq = hz; } });
}

export function setCrossfeedFeedDb(db: number): void {
  db = Clamp.crossfeedFeedDb(db);
  enqueue({ control: 'crossfeedFeedDb', debounceKey: 'crossfeedFeedDb', mutate: (s) => { s.crossfeed.feedDb = db; } });
}

export function setLevellerEnabled(enabled: boolean): void {
  enqueue({ control: 'levellerEnabled', mutate: (s) => { if (s.leveller) s.leveller.enabled = enabled; } });
}

export function setLevellerSpeed(speed: LevellerSpeed): void {
  enqueue({ control: 'levellerSpeed', mutate: (s) => { if (s.leveller) s.leveller.speed = speed; } });
}

export function setLevellerLookahead(lookahead: boolean): void {
  enqueue({ control: 'levellerLookahead', mutate: (s) => { if (s.leveller) s.leveller.lookahead = lookahead; } });
}

export function setLevellerAmount(pct: number): void {
  pct = Clamp.levellerAmountPct(pct);
  enqueue({ control: 'levellerAmount', debounceKey: 'levellerAmount', mutate: (s) => { if (s.leveller) s.leveller.amount = pct; } });
}

export function setLevellerMaxGain(db: number): void {
  db = Clamp.levellerMaxGainDb(db);
  enqueue({ control: 'levellerMaxGain', debounceKey: 'levellerMaxGain', mutate: (s) => { if (s.leveller) s.leveller.maxGainDb = db; } });
}

export function setLevellerGate(db: number): void {
  db = Clamp.levellerGateDb(db);
  enqueue({ control: 'levellerGate', debounceKey: 'levellerGate', mutate: (s) => { if (s.leveller) s.leveller.gateDb = db; } });
}

export function setMasterPreamp(db: number): void {
  db = Clamp.preampDb(db);
  enqueue({
    control: 'masterPreamp',
    coalesceKey: 'masterPreamp',
    apply: () => patchSnapshot({ masterPreampDb: db }),
    send: (d) => d.setMasterPreamp(db),
  });
}

export function setInputPreamp(channel: InputSlot, db: number): void {
  db = Clamp.preampDb(db);
  const cur = dsp.draft?.inputPreampDb;
  if (!cur) return;
  const next: [number, number] = [cur[0], cur[1]];
  next[channel] = db;
  enqueue({
    control: 'inputPreamp',
    coalesceKey: `inputPreamp:${channel}`,
    apply: () => patchSnapshot({ inputPreampDb: next }),
    send: (d) => d.setInputPreamp(channel, db),
  });
}

// All three crosspoint mutations share one per-item scrub lane keyed by the
// cell. Each send reads the full {enabled, invert, gainDb} tuple from `live`
// and writes it via setMatrixRoute, so a toggle and a gain drag on the same
// cell coalesce into one consistent write. Per-item writes do not mute audio
// (unlike the bulk path), which is why crosspoint gain stays Tier A.
function scheduleCrosspointWrite(
  input: InputSlot,
  output: OutputSlot,
  mutate: (r: RouteModel) => RouteModel,
): void {
  if (!dsp.draft?.routes) return;
  const route = focusRoute(input, output);
  enqueue({
    control: 'crosspoint',
    coalesceKey: `crosspoint:${input}:${output}`,
    apply: () => route.modify(mutate),
    send: async (d) => {
      const c = route.read();
      await d.setMatrixRoute(input, output, {
        enabled: c.enabled,
        invert: c.invert,
        gainDb: c.gainDb,
      });
    },
  });
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
  enqueue({
    control: 'outputGain',
    coalesceKey: `outputGain:${slot}`,
    apply: () => out.modify((o) => ({ ...o, gainDb })),
    send: (d) => d.setOutputGain(slot, gainDb),
  });
}

export function setOutputDelay(slot: OutputSlot, delayMs: number): void {
  if (!dsp.draft?.outputs) return;
  delayMs = Clamp.outputDelayMs(delayMs);
  enqueue({ control: 'outputDelay', mutate: (s) => {
    const o = s.outputs.find((o) => o.wireIndex === slot);
    if (o) o.delayMs = delayMs;
  } });
}

export function setOutputEnabled(slot: OutputSlot, enabled: boolean): void {
  if (!dsp.draft?.outputs) return;
  enqueue({ control: 'outputEnabled', mutate: (s) => {
    const o = s.outputs.find((o) => o.wireIndex === slot);
    if (o) o.enabled = enabled;
  } });
}

export function setOutputMuted(slot: OutputSlot, muted: boolean): void {
  if (!dsp.draft?.outputs) return;
  enqueue({ control: 'outputMuted', mutate: (s) => {
    const o = s.outputs.find((o) => o.wireIndex === slot);
    if (o) o.muted = muted;
  } });
}

export async function syncDeviceSnapshot(): Promise<void> {
  if (inflightSync) return inflightSync;
  const d = session.device;
  if (!d) throw new Error('No device');
  inflightSync = (async () => {
    try {
      const snap = await d.getSnapshot();
      applyBaselineConverged(snap);
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
      s.add(cancelResync);
      s.add(() => cancelAllCommands());
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
  await flushPending();
  const r = await d.factoryReset();
  // r.message is always present on the failure branch; map the typed flash
  // code to the action wrapper's string channel.
  if (!r.ok) return Result.fail('factory reset failed', r.message);
  invalidatePresetCache();
  clearCopySource();
  await syncDeviceSnapshot();
  return Result.ok();
}
