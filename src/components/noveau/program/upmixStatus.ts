export type UpmixStatus = 'active' | 'disabled' | 'input not stereo' | 'rate > 48 kHz';

/** Client-side mirror of the firmware's parked-reason logic. */
export function upmixStatus(
  enabled: boolean,
  activeInputChannels: number | null,
  sampleRateHz: number | null,
): UpmixStatus {
  if (!enabled) return 'disabled';
  if (activeInputChannels != null && activeInputChannels !== 2) return 'input not stereo';
  if (sampleRateHz != null && sampleRateHz > 48000) return 'rate > 48 kHz';
  return 'active';
}

export function upmixStatusText(status: UpmixStatus): string {
  return status === 'active' ? 'ACTIVE' : `PARKED — ${status}`;
}
