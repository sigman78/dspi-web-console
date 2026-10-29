// Reactive store for the selectable output latency (fw 1.1.6 branch, vendor
// request 0x03). Not part of the bulk packet. There is no capability flag, so
// `supported` is null until the first probe lands, then true/false.

import type { OutputLatencyOption, OutputLatencyStatus } from '@/domain';

export interface OutputLatencyState {
  status: OutputLatencyStatus | null;
  options: OutputLatencyOption[] | null;
  supported: boolean | null;
  busy: boolean;
}

export function createOutputLatencyState(): OutputLatencyState {
  const s = $state<OutputLatencyState>({
    status: null,
    options: null,
    supported: null,
    busy: false,
  });
  return s;
}
