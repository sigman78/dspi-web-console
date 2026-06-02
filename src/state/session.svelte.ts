import type { DspDevice } from '@/device/DspDevice';
import type { HardwareProfile } from '@/domain';

// Discriminates an 'error' status so the UI can give certain failures a tailored
// treatment (e.g. a firmware-upgrade prompt) instead of the generic diagnostics
// panel. null = an ordinary/unclassified error.
export type SessionErrorKind = null | 'unsupported-firmware';

export const session = $state<{
  device: DspDevice | null;
  hardware: HardwareProfile | null;
}>({
  device: null,
  hardware: null,
});

export function bindDevice(d: DspDevice | null): void {
  session.device = d;
  if (d == null) {
    session.hardware = null;
  } else {
    session.hardware = d.hardware;
  }
}
