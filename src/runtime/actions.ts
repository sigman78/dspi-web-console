import {
  fromBulkParams,
  type FilterParams,
  type ChannelId, type InputSlot, type OutputSlot,
  type HardwareProfile,
  CrossfeedPreset, LevellerSpeed, MasterVolumeMode,
} from '../domain';
import type { BulkParams } from '../protocol/bulkParser';
import type { DspTransport } from '../transport/DspTransport';
import type { DspDevice } from '../device/DspDevice';
import {
  bindDevice, session, setStatus,
  presets,
  applyDspSnapshot, dsp, patchSnapshot, resetDsp,
  settings, reconcileEqTarget,
  resetStatus, status,
  clearCopySource,
} from '../state';
import { Result, Log } from '../utils';
import { startPolling, stopPolling } from './poll';
import { cancelResync } from './resync';
import { batchCommand, cancelAllCommands, cancelScrubLane, instantCommand, scrubCommand } from './commands';
import { focusChannel, focusOutput, focusRoute, tryFocusOutput } from './focus';
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
  const ch = focusChannel(channel);
  if (band >= ch.read().filters.length) {
    throw new Error(`band ${band} out of range for channel ${channel}`);
  }
  scrubCommand({
    key: `eqFilter:${channel}:${band}`,
    apply: () => ch.modify((c) => {
      const filters = c.filters.slice();
      filters[band] = { ...filter };
      return { ...c, filters };
    }),
    send: (d) => d.setFilter(channel, band, filter),
  });
}

// Copy all bands from source channel onto target channel as a single
// batched action: one pending token, one optimistic snapshot patch, one
// trailing resync. The wire burst writes each band sequentially; if any
// write fails, the batch's catch path forces a resync to converge UI to
// device truth.
export function copyEqBands(sourceId: ChannelId, targetId: ChannelId): void {
  if (sourceId === targetId) return;
  if (!dsp.live?.channels) return;
  const src = focusChannel(sourceId);
  const tgt = focusChannel(targetId);
  const len = Math.min(src.read().filters.length, tgt.read().filters.length);
  const copied = src.read().filters.slice(0, len).map((f) => ({ ...f }));

  // Drop any pending per-band scrubs on the target. Their closures captured
  // the pre-copy filter and would clobber the just-copied bands when they
  // fire ~16ms later. Cancelling drops the timer + pending token cleanly.
  for (let i = 0; i < len; i++) cancelScrubLane(`eqFilter:${targetId}:${i}`);

  batchCommand({
    apply: () => tgt.modify((c) => {
      const filters = c.filters.slice();
      for (let i = 0; i < len; i++) filters[i] = { ...copied[i] };
      return { ...c, filters };
    }),
    send: async (d) => {
      for (let i = 0; i < len; i++) {
        await d.setFilter(targetId, i, copied[i]);
      }
    },
  });
}

export function setBypass(enabled: boolean): void {
  if (dsp.live == null) return;
  instantCommand({
    apply: () => patchSnapshot({ bypass: enabled }),
    send: (d) => d.setBypass(enabled),
  });
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
// what `displayNameForChannel` produces after a bulk resync.
export function setChannelName(id: ChannelId, name: string): void {
  if (!dsp.live?.channels) return;
  const ch = focusChannel(id);
  const resolved = name.trim() || ch.read().defaultName;
  const outSlot = dsp.live.outputs.find((output) => output.id === id)?.wireIndex;
  const out = outSlot != null ? tryFocusOutput(outSlot) : null;
  instantCommand({
    apply: () => {
      ch.modify((c) => ({ ...c, name: resolved }));
      // Mirror to the denormalised outputs[] entry so MatrixHeader and
      // OverviewTab update without waiting for the trailing bulk resync.
      out?.modify((o) => ({ ...o, name: resolved }));
    },
    send: (d) => d.setChannelName(id, name),
  });
}

export function setLoudnessEnabled(enabled: boolean): void {
  const cur = dsp.live?.loudness;
  if (!cur) return;
  instantCommand({
    apply: () => patchSnapshot({ loudness: { ...cur, enabled } }),
    send: (d) => d.setLoudnessEnabled(enabled),
  });
}

export function setLoudnessRefSpl(db: number): void {
  const cur = dsp.live?.loudness;
  if (!cur) return;
  scrubCommand({
    key: 'loudnessRefSpl',
    apply: () => patchSnapshot({ loudness: { ...cur, refSpl: db } }),
    send: (d) => d.setLoudnessRefSpl(db),
  });
}

export function setLoudnessIntensityPct(pct: number): void {
  const cur = dsp.live?.loudness;
  if (!cur) return;
  scrubCommand({
    key: 'loudnessIntensity',
    apply: () => patchSnapshot({ loudness: { ...cur, intensityPct: pct } }),
    send: (d) => d.setLoudnessIntensity(pct),
  });
}

export function setCrossfeedEnabled(enabled: boolean): void {
  const cur = dsp.live?.crossfeed;
  if (!cur) return;
  instantCommand({
    apply: () => patchSnapshot({ crossfeed: { ...cur, enabled } }),
    send: (d) => d.setCrossfeedEnabled(enabled),
  });
}

export function setCrossfeedPreset(preset: CrossfeedPreset): void {
  const cur = dsp.live?.crossfeed;
  if (!cur) return;
  instantCommand({
    apply: () => patchSnapshot({ crossfeed: { ...cur, preset } }),
    send: (d) => d.setCrossfeedPreset(preset),
  });
}

export function setCrossfeedItd(itd: boolean): void {
  const cur = dsp.live?.crossfeed;
  if (!cur) return;
  instantCommand({
    apply: () => patchSnapshot({ crossfeed: { ...cur, itd } }),
    send: (d) => d.setCrossfeedItd(itd),
  });
}

export function setCrossfeedFreq(hz: number): void {
  const cur = dsp.live?.crossfeed;
  if (!cur) return;
  scrubCommand({
    key: 'crossfeedFreq',
    apply: () => patchSnapshot({ crossfeed: { ...cur, freq: hz } }),
    send: (d) => d.setCrossfeedFreq(hz),
  });
}

export function setCrossfeedFeedDb(db: number): void {
  const cur = dsp.live?.crossfeed;
  if (!cur) return;
  scrubCommand({
    key: 'crossfeedFeedDb',
    apply: () => patchSnapshot({ crossfeed: { ...cur, feedDb: db } }),
    send: (d) => d.setCrossfeedFeedDb(db),
  });
}

export function setLevellerEnabled(enabled: boolean): void {
  const cur = dsp.live?.leveller;
  if (!cur) return;
  instantCommand({
    apply: () => patchSnapshot({ leveller: { ...cur, enabled } }),
    send: (d) => d.setLevellerEnabled(enabled),
  });
}

export function setLevellerSpeed(speed: LevellerSpeed): void {
  const cur = dsp.live?.leveller;
  if (!cur) return;
  instantCommand({
    apply: () => patchSnapshot({ leveller: { ...cur, speed } }),
    send: (d) => d.setLevellerSpeed(speed),
  });
}

export function setLevellerLookahead(lookahead: boolean): void {
  const cur = dsp.live?.leveller;
  if (!cur) return;
  instantCommand({
    apply: () => patchSnapshot({ leveller: { ...cur, lookahead } }),
    send: (d) => d.setLevellerLookahead(lookahead),
  });
}

export function setLevellerAmount(pct: number): void {
  const cur = dsp.live?.leveller;
  if (!cur) return;
  scrubCommand({
    key: 'levellerAmount',
    apply: () => patchSnapshot({ leveller: { ...cur, amount: pct } }),
    send: (d) => d.setLevellerAmount(pct),
  });
}

export function setLevellerMaxGain(db: number): void {
  const cur = dsp.live?.leveller;
  if (!cur) return;
  scrubCommand({
    key: 'levellerMaxGain',
    apply: () => patchSnapshot({ leveller: { ...cur, maxGainDb: db } }),
    send: (d) => d.setLevellerMaxGain(db),
  });
}

export function setLevellerGate(db: number): void {
  const cur = dsp.live?.leveller;
  if (!cur) return;
  scrubCommand({
    key: 'levellerGate',
    apply: () => patchSnapshot({ leveller: { ...cur, gateDb: db } }),
    send: (d) => d.setLevellerGate(db),
  });
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
  const out = focusOutput(slot);
  scrubCommand({
    key: `outputDelay:${slot}`,
    apply: () => out.modify((o) => ({ ...o, delayMs })),
    send: (d) => d.setOutputDelay(slot, delayMs),
  });
}

export function toggleCrosspoint(input: InputSlot, output: OutputSlot): void {
  if (!dsp.live?.routes) return;
  const route = focusRoute(input, output);
  instantCommand({
    apply: () => route.modify((c) => ({ ...c, enabled: !c.enabled })),
    send: (d) => {
      const cur = route.read();
      return d.setMatrixRoute(input, output, {
        enabled: cur.enabled,
        invert: cur.invert,
        gainDb: cur.gainDb,
      });
    },
  });
}

export function toggleCrosspointInvert(input: InputSlot, output: OutputSlot): void {
  if (!dsp.live?.routes) return;
  const route = focusRoute(input, output);
  instantCommand({
    apply: () => route.modify((c) => ({ ...c, invert: !c.invert })),
    send: (d) => {
      const cur = route.read();
      return d.setMatrixRoute(input, output, {
        enabled: cur.enabled,
        invert: cur.invert,
        gainDb: cur.gainDb,
      });
    },
  });
}

export function toggleOutputEnable(slot: OutputSlot): void {
  if (!dsp.live?.outputs) return;
  const out = focusOutput(slot);
  instantCommand({
    apply: () => out.modify((o) => ({ ...o, enabled: !o.enabled })),
    send: (d) => d.setOutputEnable(slot, out.read().enabled),
  });
}

export function toggleOutputMute(slot: OutputSlot): void {
  if (!dsp.live?.outputs) return;
  const out = focusOutput(slot);
  instantCommand({
    apply: () => out.modify((o) => ({ ...o, muted: !o.muted })),
    send: (d) => d.setOutputMute(slot, out.read().muted),
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
  applyDspSnapshot(fromBulkParams(hardware, bulk));
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
