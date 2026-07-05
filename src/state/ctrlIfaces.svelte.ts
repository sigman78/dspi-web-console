// Reactive store for the V16 external control interfaces (UART + I2C).
// Unlike presets/telemetry these aren't part of the bulk packet -- they're
// fetched once via their own vendor commands (see runtime/deviceService.ts).

import type { UartControlConfig, I2cControlConfig, ControlIfaceStatus } from '@/domain';

export interface CtrlIfacesState {
  uart: UartControlConfig | null;
  i2c: I2cControlConfig | null;
  status: ControlIfaceStatus | null;
  busy: boolean;
  lastFetchError: string | null;
}

export function createCtrlIfacesState(): CtrlIfacesState {
  const s = $state<CtrlIfacesState>({
    uart: null,
    i2c: null,
    status: null,
    busy: false,
    lastFetchError: null,
  });
  return s;
}
