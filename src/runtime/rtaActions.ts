import * as Domain from '@/domain';
import { Log } from '@/utils';
import { TimeoutError } from '@/transport/withTimeout';
import type { ReadySession } from '@/state';
import type { DspDevice } from '@/device/DspDevice';

// Brings the analyser to a usable state: caps and centres once per session,
// then the shared-config decision on every new interest period. Only a failed
// first caps read (the firmware STALLs it when the module is absent) or a
// caps layout we don't speak latches 'unavailable', leaving the simulated
// spectrum for the session. Any later failure leaves setup pending for a
// retry; a timeout propagates so the caller counts it against link health.
// Returns whether bands can be read.
export async function setupRta(session: ReadySession, d: DspDevice): Promise<boolean> {
  const tele = session.telemetry;
  let caps = tele.rtaCaps;
  if (!caps) {
    try {
      caps = await session.queue.run(() => d.getRtaCaps());
    } catch (e) {
      if (e instanceof TimeoutError) throw e;
      tele.rtaAvailability = 'unavailable';
      Log.warn('rta', 'analyser unavailable; spectrum stays simulated', e);
      return false;
    }
    if (caps.version !== Domain.RTA_CONFIG_VERSION) {
      tele.rtaAvailability = 'unavailable';
      Log.warn('rta', `unsupported analyser layout v${caps.version}; spectrum stays simulated`);
      return false;
    }
    tele.rtaCaps = caps;
  }
  try {
    if (tele.rtaCentres.length === 0) {
      const found = caps;
      tele.rtaCentres = await session.queue.run(() => d.getRtaCentres(found.maxBands));
    }
    const applied = await session.queue.run(() => d.getRtaConfig());
    const wanted = Domain.rtaWantedConfig(caps, d.hardware.outputCount);
    const push = Domain.rtaPlanConfig(applied, wanted);
    if (push) await session.queue.run(() => d.setRtaConfig(push));
    tele.rtaConfig = push ?? applied;
    tele.rtaAvailability = 'available';
    tele.rtaConfigured = true;
    return true;
  } catch (e) {
    if (e instanceof TimeoutError) throw e;
    if (!tele.rtaSetupWarned) {
      tele.rtaSetupWarned = true;
      Log.warn('rta', 'analyser setup failed; will retry', e);
    }
    return false;
  }
}

// One bands-all read, folded into telemetry. Skips the write if interest was
// released mid-read.
export async function readRtaFrames(session: ReadySession, d: DspDevice, withStatus: boolean): Promise<void> {
  const tele = session.telemetry;
  const caps = tele.rtaCaps;
  if (!caps) return;
  const raw = await session.queue.run(() => d.getRtaBandsAll());
  const status = withStatus ? await session.queue.run(() => d.getRtaStatus()) : null;
  if (tele.rtaWanted <= 0) return;
  tele.rtaFrames = raw.map((f) => Domain.rtaDecodeFrame(f, caps));
  tele.lastRtaReplyMs = performance.now();
  if (status) {
    // Another host moved the analyser off the output tap: redo setup.
    if (status.tap !== Domain.RtaTap.Output) tele.rtaConfigured = false;
    tele.rtaStatus = status;
    tele.lastRtaStatusMs = performance.now();
  }
}
