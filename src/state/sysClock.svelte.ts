// Reactive store for the selectable system clock (fw overclock branch,
// 0x40/0x41). Not part of the bulk packet -- fetched via its own vendor
// commands (see runtime/deviceService.ts). There is no capability flag, so
// `supported` is null until the first probe lands, then true/false.

import type { SysClockStatus } from '@/domain';

export interface SysClockState {
  status: SysClockStatus | null;
  supported: boolean | null;
  busy: boolean;
}

export function createSysClockState(): SysClockState {
  const s = $state<SysClockState>({
    status: null,
    supported: null,
    busy: false,
  });
  return s;
}
