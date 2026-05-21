import {
  fromBulkParams,
  type FilterParams,
  type ChannelId, type InputSlot, type OutputSlot,
  type HardwareProfile,
  CrossfeedPreset, LevellerSpeed, MasterVolumeMode,
} from '@/domain';
import type { BulkParams } from '@/protocol';
import type { DspTransport } from '@/transport/DspTransport';
import type { DspDevice } from '@/device/DspDevice';
import {
  bindDevice, session, setStatus,
  presets,
  applyDspSnapshot, dsp, patchSnapshot, resetDsp,
  settings, reconcileEqTarget,
  resetStatus, status,
  clearCopySource,
} from '@/state';
import { Result, Log } from '@/utils';
import { startPolling, stopPolling } from './poll';
import { cancelResync } from './resync';
import { cancelAllCommands, scrubCommand } from './commands';
import { commitBulk, commitBulkDebounced } from './commit';
import { focusOutput, focusRoute } from './focus';
import { fetchPresetInfo, invalidatePresetCache } from './presets';

const MUTE_DB = -128; // per spec

function _setMasterVolume(db: number): void {
  scrubCommand({
    key: 'masterVolume',
    apply: () => patchSnapshot({ masterVolumeDb: db }),
    send: (d) => d.setMasterVolume(db),
  });
}

let inflightSync: Promise<void> | null = null;
let lastTransportCleanup: (() => void) | null = null;

export function setEqFilter(channel: ChannelId, band: number, filter: FilterParams): void {
  if (!dsp.live?.channels) return;
  const ch = dsp.live.channels.find((c) => c.id === channel);
  if (!ch) return;
  if (band >= ch.filters.length) {
    throw new Error(`band ${band} out of range for channel ${channel}`);
  }
  commitBulk((s) => {
    const c = s.channels.find((c) => c.id === channel)!;
    c.filters[band] = { ...filter };
  });
}

// Copy all bands from source channel onto target channel as a single
// bulk write. Under commitBulk, EQ edits no longer have per-band scrub
// lanes, so no cancelScrubLane calls are needed.
export function copyEqBands(sourceId: ChannelId, targetId: ChannelId): void {
  if (sourceId === targetId || !dsp.live?.channels) return;
  const src = dsp.live.channels.find((c) => c.id === sourceId);
  const tgt = dsp.live.channels.find((c) => c.id === targetId);
  if (!src || !tgt) return;
  const len = Math.min(src.filters.length, tgt.filters.length);
  const copied = src.filters.slice(0, len).map((f) => ({ ...f }));
  commitBulk((s) => {
    const t = s.channels.find((c) => c.id === targetId)!;
    for (let i = 0; i < len; i++) t.filters[i] = { ...copied[i] };
  });
}

export function setBypass(enabled: boolean): void {
  commitBulk((s) => { s.bypass = enabled; });
}

// Telemetry-only action: clears firmware-side latched clip flags (0x83) and
// resets the host-side OR-latch (`status.clipLatched`). Not routed through
// `instantCommand` because clip state lives in telemetry, not the DSP
// snapshot, so the post-send bulk resync would be pure overhead. If the
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
  if (!dsp.live?.channels) return;
  const ch = dsp.live.channels.find((c) => c.id === id);
  if (!ch) return;
  const resolved = name.trim() || ch.defaultName;
  commitBulk((s) => {
    const c = s.channels.find((c) => c.id === id)!;
    c.name = resolved;
    const o = s.outputs.find((o) => o.id === id);
    if (o) o.name = resolved;
  });
}

export function setLoudnessEnabled(enabled: boolean): void {
  commitBulk((s) => { s.loudness.enabled = enabled; });
}

export function setLoudnessRefSpl(db: number): void {
  commitBulkDebounced('loudnessRefSpl', (s) => { s.loudness.refSpl = db; });
}

export function setLoudnessIntensityPct(pct: number): void {
  commitBulkDebounced('loudnessIntensity', (s) => { s.loudness.intensityPct = pct; });
}

export function setCrossfeedEnabled(enabled: boolean): void {
  commitBulk((s) => { s.crossfeed.enabled = enabled; });
}

export function setCrossfeedPreset(preset: CrossfeedPreset): void {
  commitBulk((s) => { s.crossfeed.preset = preset; });
}

export function setCrossfeedItd(itd: boolean): void {
  commitBulk((s) => { s.crossfeed.itd = itd; });
}

export function setCrossfeedFreq(hz: number): void {
  commitBulkDebounced('crossfeedFreq', (s) => { s.crossfeed.freq = hz; });
}

export function setCrossfeedFeedDb(db: number): void {
  commitBulkDebounced('crossfeedFeedDb', (s) => { s.crossfeed.feedDb = db; });
}

export function setLevellerEnabled(enabled: boolean): void {
  commitBulk((s) => { if (s.leveller) s.leveller.enabled = enabled; });
}

export function setLevellerSpeed(speed: LevellerSpeed): void {
  commitBulk((s) => { if (s.leveller) s.leveller.speed = speed; });
}

export function setLevellerLookahead(lookahead: boolean): void {
  commitBulk((s) => { if (s.leveller) s.leveller.lookahead = lookahead; });
}

export function setLevellerAmount(pct: number): void {
  commitBulkDebounced('levellerAmount', (s) => { if (s.leveller) s.leveller.amount = pct; });
}

export function setLevellerMaxGain(db: number): void {
  commitBulkDebounced('levellerMaxGain', (s) => { if (s.leveller) s.leveller.maxGainDb = db; });
}

export function setLevellerGate(db: number): void {
  commitBulkDebounced('levellerGate', (s) => { if (s.leveller) s.leveller.gateDb = db; });
}

export function setMasterPreamp(db: number): void {
  scrubCommand({
    key: 'masterPreamp',
    apply: () => patchSnapshot({ masterPreampDb: db }),
    send: (d) => d.setMasterPreamp(db),
  });
}

export function setInputPreamp(channel: InputSlot, db: number): void {
  const cur = dsp.live?.inputPreampDb;
  if (!cur) return;
  const next: [number, number] = [cur[0], cur[1]];
  next[channel] = db;
  scrubCommand({
    key: `inputPreamp:${channel}`,
    apply: () => patchSnapshot({ inputPreampDb: next }),
    send: (d) => d.setInputPreamp(channel, db),
  });
}

export function setCrosspointGain(input: InputSlot, output: OutputSlot, gainDb: number): void {
  if (!dsp.live?.routes) return;
  const route = focusRoute(input, output);
  scrubCommand({
    key: `crosspointGain:${input}:${output}`,
    apply: () => route.modify((c) => ({ ...c, gainDb })),
    send: async (d) => {
      // Read at send time. Scrub fires 16ms after schedule; an intervening
      // toggleCrosspoint(Invert) could have updated enabled or invert in
      // that window, and setMatrixRoute writes the full tuple. Reading via
      // focus keeps those edits intact.
      const cur = route.read();
      await d.setMatrixRoute(input, output, {
        enabled: cur.enabled,
        invert: cur.invert,
        gainDb: cur.gainDb,
      });
    },
  });
}
export function setOutputGain(slot: OutputSlot, gainDb: number): void {
  if (!dsp.live?.outputs) return;
  const out = focusOutput(slot);
  scrubCommand({
    key: `outputGain:${slot}`,
    apply: () => out.modify((o) => ({ ...o, gainDb })),
    send: (d) => d.setOutputGain(slot, gainDb),
  });
}

export function setOutputDelay(slot: OutputSlot, delayMs: number): void {
  if (!dsp.live?.outputs) return;
  commitBulk((s) => {
    const o = s.outputs.find((o) => o.wireIndex === slot);
    if (o) o.delayMs = delayMs;
  });
}

export function toggleCrosspoint(input: InputSlot, output: OutputSlot): void {
  commitBulk((s) => {
    const r = s.routes.find((r) => r.inputIndex === input && r.outputWireIndex === output);
    if (r) r.enabled = !r.enabled;
  });
}

export function toggleCrosspointInvert(input: InputSlot, output: OutputSlot): void {
  commitBulk((s) => {
    const r = s.routes.find((r) => r.inputIndex === input && r.outputWireIndex === output);
    if (r) r.invert = !r.invert;
  });
}

export function toggleOutputEnable(slot: OutputSlot): void {
  commitBulk((s) => {
    const o = s.outputs.find((o) => o.wireIndex === slot);
    if (o) o.enabled = !o.enabled;
  });
}

export function toggleOutputMute(slot: OutputSlot): void {
  commitBulk((s) => {
    const o = s.outputs.find((o) => o.wireIndex === slot);
    if (o) o.muted = !o.muted;
  });
}

export async function syncDeviceSnapshot(): Promise<void> {
  if (inflightSync) return inflightSync;
  const d = session.device;
  if (!d) throw new Error('No device');
  inflightSync = (async () => {
    try {
      const bulk = await d.getAllParams();
      const hardware = d.hardware;
      session.hardware = hardware;
      hydrateFromBulk(hardware, bulk);
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

export async function refreshDeviceSnapshotBaseline(): Promise<void> {
  await syncDeviceSnapshot();
}

export async function finishConnection(device: DspDevice): Promise<void> {
  if (session.device !== device) {
    throw new Error('Cannot finish connection for inactive device');
  }
  setStatus('connecting');
  try {
    await refreshDeviceSnapshotBaseline();
    setStatus('connected');
    settings.lastSerial = device.info.serial;
    await reconcileAfterSync();
    startPolling();
    await fetchPresetInfo();
    Log.info('sync', 'connected', {
      platform: dsp.live?.platform.name,
      formatVersion: dsp.live?.formatVersion,
      masterVolumeDb: dsp.live?.masterVolumeDb,
    });
  } catch (err) {
    Log.error('sync', 'finishConnection failed', err);
    setStatus('error', (err as Error).message);
    throw err;
  }
}

export async function fullSync(): Promise<void> {
  await refreshDeviceSnapshotBaseline();
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
    const restoreFrom = settings.soft.mutedFromDb ?? dsp.live?.masterVolumeDb ?? 0;
    settings.soft.mutedFromDb = restoreFrom;
    patchSnapshot({ masterVolumeDb: MUTE_DB });
    await d.setMasterVolume(MUTE_DB);
  }
}

function hydrateFromBulk(hardware: HardwareProfile, bulk: BulkParams): void {
  applyDspSnapshot(fromBulkParams(hardware, bulk), bulk);
}

export function setMasterVolume(db: number): void {
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
    settings.soft.mutedFromDb = dsp.live?.masterVolumeDb ?? 0;
    settings.soft.muted = true;
    _setMasterVolume(MUTE_DB);
  }
}

export function attachTransportListeners(transport: DspTransport): () => void {
  if (lastTransportCleanup) {
    lastTransportCleanup();
    lastTransportCleanup = null;
  }
  const offDisc = transport.on('disconnect', () => {
    cancelResync();
    cancelAllCommands();
    stopPolling();
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
  const cleanup = () => { offDisc(); offConn(); };
  lastTransportCleanup = cleanup;
  return cleanup;
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
export async function saveMasterVolumeBaseline(): Promise<Result<void, string>> {
  const d = session.device;
  if (!d) return Result.fail('no device', 'no device');
  const success = await d.saveMasterVolume();
  return success ? Result.ok(undefined) : Result.fail('write error', 'flash write error');
}
