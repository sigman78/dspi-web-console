// Public verb surface -- actions, preset operations, session lifecycle. Flat
// exports so call sites read as `setMasterVolume()`, not `Actions.setMasterVolume()`.
//
// Intentionally NOT re-exported: `commands`, `focus`, `resync` -- internal
// coordination primitives used only within this directory.
export * from './actions';
export * from './stagedActions';
export * from './deviceService';
export * from './presets';
export * from './boot';
export * from './poll';
export * from './deviceLock';
export * from './notifyChannel';
