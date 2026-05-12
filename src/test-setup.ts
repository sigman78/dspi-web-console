import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

// src/utils/log.ts emits `[dspi:*]`-prefixed diagnostics through console.* and
// keeps error logging on unconditionally. Tests that exercise failure paths
// (commands.test.ts, actions.test.ts, etc.) intentionally trigger these and
// pollute test output. Filter the prefix; pass everything else through so real
// console output from tests still surfaces.
const isDspi = (args: unknown[]) => typeof args[0] === 'string' && args[0].startsWith('[dspi:');
for (const method of ['error', 'warn', 'info', 'log'] as const) {
  const original = console[method].bind(console);
  console[method] = (...args: unknown[]) => { if (!isDspi(args)) original(...args); };
}
