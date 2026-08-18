// Reactive store for the selectable system clock (fw overclock branch,
// 0x40/0x41). Not part of the bulk packet -- fetched via its own vendor
// commands (see runtime/deviceService.ts). null status is the "unsupported or
// not yet probed" signal; there is no capability flag to gate on instead.

import type { SysClockStatus } from '@/domain';

export interface SysClockState {
  status: SysClockStatus | null;
  busy: boolean;
}

export function createSysClockState(): SysClockState {
  const s = $state<SysClockState>({
    status: null,
    busy: false,
  });
  return s;
}
