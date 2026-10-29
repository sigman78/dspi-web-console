// Dev/debug URL options -- the single home for every ?param the console honors.
//
//   ?mock[=<profile>]   boot a synthesized device instead of USB:
//       latest (default)  newest wire, models the fw 1.1.6 release-branch head
//                         (reports beta 5: output latency, ring health, CS v21)
//       multi             latest + 8ch I2S input + 3 S/PDIF inputs
//       v<N>              exact bulk/wire format N (v28..vMAX) as the tagged
//                         firmware ships it: CS caps v14 (v28/v29), v18 (v30),
//                         v20 (v32); v31/v32 are plain beta 4 (no output
//                         latency)
//     a comma list (?mock=latest,v28) boots one device per token: the
//     first is active, the rest adopt dormant -- the multi-device fleet
//     harness, no hardware needed
//     &chip=rp2040|rp2350  hardware flavor, combinable with any profile
//                          (default rp2350; rp2040 = 5 outputs, fewer pairs)
//     &cs=full           fill every control-surface table to capacity (16
//                        bindings incl. IR receiver + display, 8 macros of 8
//                        steps, 8 groups, 16 IR commands, 16 display pages)
//   ?debug              show diagnostics panels (SETUP > DEVICE buffer stats)
//   ?hero               force the connecting hero even while connected
//   ?sysclock=fallback  boot the mock system clock crash-fallen-back (stored
//                       mode 2, active safe mode 0) to demo the fallback banner
//   ?sysclock=off       boot the mock without the system-clock opcodes, as released
//                       1.1.5/1.1.6 firmware answers (the panel stays hidden)
//   ?log=0              silence the diagnostic logger (errors still log)
//   ?log=wire           additionally trace every wire message
//
// Profile -> MockOptions resolution lives in src/mockProfiles.ts (it needs
// the Wire version bounds, which this module cannot import -- see below).
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

export function mockCsFull(): boolean {
  return params()?.get('cs') === 'full';
}

export function heroOverride(): boolean {
  return params()?.has('hero') ?? false;
}

export function debugPanels(): boolean {
  return params()?.has('debug') ?? false;
}

export function mockSysClockOff(): boolean {
  return params()?.get('sysclock') === 'off';
}

export function mockSysClockFallback(): boolean {
  return params()?.get('sysclock') === 'fallback';
}

export function logSilenced(): boolean {
  return params()?.get('log') === '0';
}

export function wireLogEnabled(): boolean {
  return params()?.get('log') === 'wire';
}
