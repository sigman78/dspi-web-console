import { UpmixParkedReason } from './processing';

// 'unknown' is the upmixer v2 state before the first status read. The other
// v2-only values mirror the device's reported parked reasons 2 and 4 to 6.
export type UpmixParking =
  | 'active' | 'disabled' | 'input not stereo' | 'rate > 48 kHz'
  | 'unknown' | 'no profile for input' | 'source absent' | 'fading out' | 'nothing routed';

/** Client-side mirror of the firmware's parked-reason logic (upmixer v1). */
export function upmixParkingStatus(
  enabled: boolean,
  activeInputChannels: number | null,
  sampleRateHz: number | null,
): UpmixParking {
  if (!enabled) return 'disabled';
  if (activeInputChannels != null && activeInputChannels !== 2) return 'input not stereo';
  if (sampleRateHz != null && sampleRateHz > 48000) return 'rate > 48 kHz';
  return 'active';
}

const REPORTED: Record<UpmixParkedReason, UpmixParking> = {
  [UpmixParkedReason.Active]: 'active',
  [UpmixParkedReason.Disabled]: 'disabled',
  [UpmixParkedReason.NotStereoInput]: 'no profile for input',
  [UpmixParkedReason.RateAbove48k]: 'rate > 48 kHz',
  [UpmixParkedReason.SourceAbsent]: 'source absent',
  [UpmixParkedReason.FadingOut]: 'fading out',
  [UpmixParkedReason.NothingRouted]: 'nothing routed',
};

/**
 * The status to show. Upmixer v2 firmware (`upmixRoutes`) reports its own
 * parked reason, so nothing is derived from the config there: `reported` is
 * null until the first read.
 */
export function upmixParkingFor(opts: {
  upmixRoutes: boolean;
  reported: UpmixParkedReason | null;
  enabled: boolean;
  activeInputChannels: number | null;
  sampleRateHz: number | null;
}): UpmixParking {
  if (!opts.upmixRoutes) return upmixParkingStatus(opts.enabled, opts.activeInputChannels, opts.sampleRateHz);
  return opts.reported === null ? 'unknown' : REPORTED[opts.reported];
}

export function upmixParkingText(status: UpmixParking): string {
  if (status === 'active') return 'ACTIVE';
  if (status === 'unknown') return '—';
  return `PARKED — ${status}`;
}
