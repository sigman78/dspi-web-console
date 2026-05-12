// Lightweight diagnostic logger. On in dev/build by default; turn off via
// `?log=0` URL param. Outputs are tagged `[dspi]` and grouped by stage so
// you can grep DevTools console for what happened across a connect cycle.

const enabled = (() => {
  if (typeof globalThis === 'undefined') return false;
  if (typeof location === 'undefined') return true;
  const p = new URLSearchParams(location.search).get('log');
  return p !== '0';
})();

function fmt(stage: string): string {
  return `[dspi:${stage}]`;
}

export function log(stage: string, ...args: unknown[]): void {
  if (!enabled) return;
  console.info(fmt(stage), ...args);
}

export function warn(stage: string, ...args: unknown[]): void {
  if (!enabled) return;
  console.warn(fmt(stage), ...args);
}

export function error(stage: string, ...args: unknown[]): void {
  // Errors are always logged regardless of the toggle; diagnostics matter.
  console.error(fmt(stage), ...args);
}
