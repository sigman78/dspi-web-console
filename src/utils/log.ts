// Lightweight diagnostic logger. On by default; disable via `?log=0`. Outputs
// are tagged `[dspi:<stage>]` so DevTools can be filtered by stage.

import { logSilenced } from '../devOptions';

const enabled = typeof globalThis !== 'undefined' && !logSilenced();

function fmt(stage: string): string {
  return `[dspi:${stage}]`;
}

export const Log = {
  info(stage: string, ...args: unknown[]): void {
    if (!enabled) return;
    console.info(fmt(stage), ...args);
  },
  // Verbose level -- hidden by default in DevTools (filter to "Verbose" to see).
  // Used for high-volume, low-signal output like telemetry-poll wire traffic.
  debug(stage: string, ...args: unknown[]): void {
    if (!enabled) return;
    console.debug(fmt(stage), ...args);
  },
  warn(stage: string, ...args: unknown[]): void {
    if (!enabled) return;
    console.warn(fmt(stage), ...args);
  },
  // Errors are always logged regardless of the toggle; diagnostics matter.
  error(stage: string, ...args: unknown[]): void {
    console.error(fmt(stage), ...args);
  },
};
