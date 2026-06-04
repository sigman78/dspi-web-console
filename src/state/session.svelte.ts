import type { DspDevice } from '@/device/DspDevice';
import type { HardwareProfile } from '@/domain';

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
