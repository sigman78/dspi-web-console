import type { DspDevice, DspDeviceInfo } from '@/device/DspDevice';
import type { HardwareProfile } from '@/domain';

export type SessionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

// Firmware-feature gate, derived from the connected device's bulk
// formatVersion at connect time. The bulk-write path requires the V6
// layout; older firmware degrades to per-item writes (see docs/IDEAS.md §10.4).
export interface SessionCapabilities {
  setAllParams: boolean;          // V6+ bulk write layout
  perItemMasterVolume: boolean;   // 0xD2/0xD4/0xD6 are V6+
  loudnessCrossfeedLeveller: boolean; // V4+ processing block
  i2sConfig: boolean;             // V3+ I2S section
}

export function computeCapabilities(formatVersion: number): SessionCapabilities {
  return {
    setAllParams: formatVersion >= 6,
    perItemMasterVolume: formatVersion >= 6,
    loudnessCrossfeedLeveller: formatVersion >= 4,
    i2sConfig: formatVersion >= 3,
  };
}

const NO_CAPABILITIES: SessionCapabilities = {
  setAllParams: false,
  perItemMasterVolume: false,
  loudnessCrossfeedLeveller: false,
  i2sConfig: false,
};

// lastDeviceInfo is intentionally preserved across disconnect so the UI
// can show the last-known device label until a new device is bound.
// Reconnect-identity matching uses settings.lastSerial, not this field.
export const session = $state<{
  status: SessionStatus;
  error: string | null;
  device: DspDevice | null;
  lastDeviceInfo: DspDeviceInfo | null;
  hardware: HardwareProfile | null;
  generation: number;
  capabilities: SessionCapabilities;
}>({
  status: 'idle',
  error: null,
  device: null,
  lastDeviceInfo: null,
  hardware: null,
  generation: 0,
  capabilities: NO_CAPABILITIES,
});

export function setStatus(status: SessionStatus, error: string | null = null): void {
  session.status = status;
  session.error = error;
}

export function bindDevice(d: DspDevice | null): void {
  session.device = d;
  if (d == null) {
    session.hardware = null;
    session.capabilities = NO_CAPABILITIES;
  } else {
    session.lastDeviceInfo = d.info;
    session.hardware = d.hardware;
  }
  session.generation += 1;
}
