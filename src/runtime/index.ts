// Public verb surface — actions, preset operations, session lifecycle.
// All flat-exported; verb-heavy modules read best without a namespace
// prefix (`setMasterVolume()` reads as the call site's intent; wrapping
// in `Actions.setMasterVolume()` would add noise without scope value).
//
// Intentionally NOT re-exported: `commands`, `focus`, `resync`,
// `schedulers`. They are internal coordination primitives used only by
// `actions.ts` and friends inside this directory.
export * from './actions';
export * from './presets';
export * from './session';
export * from './poll';
