// Public verb surface -- actions, preset operations, session lifecycle. Flat
// exports so call sites read as `setMasterVolume()`, not `Actions.setMasterVolume()`.
//
// Intentionally NOT re-exported: `commands`, `focus`, `resync` -- internal
// coordination primitives used only within this directory.
export * from './eqActions';
export * from './mixerActions';
export * from './volumeActions';
export * from './processingActions';
export * from './upmixActions';
export * from './ioActions';
export * from './controlSurfaceActions';
export * from './systemActions';
export * from './stagedActions';
export * from './deviceService';
export * from './presets';
export * from './boot';
export * from './poll';
export * from './notifyChannel';
export * from './autoEqApply';
