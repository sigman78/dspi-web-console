// Dev/debug URL options -- the single home for every ?param the console honors.
//
//   ?mock[=<profile>]   boot a synthesized device instead of USB:
//       latest (default)  newest wire / fw 1.1.5
//       legacy            wire V10 / fw 1.1.4
//       multi             latest + 8ch I2S input + 3 S/PDIF inputs
//       v<N>              exact bulk/wire format N (v10, v16..vMAX)
//     &chip=rp2040|rp2350  hardware flavor, combinable with any profile
//                          (default rp2350; rp2040 = 5 outputs, fewer pairs)
//   ?hero               force the connecting hero even while connected
//   ?log=0              silence the diagnostic logger (errors still log)
//   ?log=wire           additionally trace every wire message
//
// Profile -> MockOptions resolution lives in src/mockProfiles.ts (it needs
// Wire.MAX_WIRE_VERSION, which this module cannot import -- see below).
//
// Every reader below pulls from `location.search` at call time (not cached at
// module load) so tests can `history.replaceState` and re-read. No imports:
// this module must stay safe for src/utils/log.ts to depend on.

function params(): URLSearchParams | null {
  if (typeof location === 'undefined') return null;
  return new URLSearchParams(location.search);
}

// Raw ?mock token: null when absent, '' for a bare ?mock, else the value
// verbatim (unvalidated -- src/mockProfiles.ts resolves it to a profile).
export function mockToken(): string | null {
  const p = params();
  if (p === null || !p.has('mock')) return null;
  return p.get('mock') ?? '';
}

// Raw &chip= hardware flavor: null when absent or unrecognized (-> rp2350).
export function mockChip(): 'rp2040' | 'rp2350' | null {
  const chip = params()?.get('chip');
  return chip === 'rp2040' || chip === 'rp2350' ? chip : null;
}

export function heroOverride(): boolean {
  return params()?.has('hero') ?? false;
}

export function logSilenced(): boolean {
  return params()?.get('log') === '0';
}

export function wireLogEnabled(): boolean {
  return params()?.get('log') === 'wire';
}
