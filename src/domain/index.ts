// Constants-heavy modules — exposed as namespaces (matches existing
// `import * as Eq` / `import * as Mix` convention; lets callers reach
// for `Eq.FREQ_MIN_HZ` and `Mix.OUTPUT_GAIN_MAX_DB` without flooding
// the local scope with a dozen bare constants).
export * as Eq from './eqLimits';
export * as Mix from './mixerLimits';
export * as Proc from './processingLimits';

// Flat re-exports — the const enums (`ChannelId.Left`, `FilterType.Peak`,
// `PlatformType.RP2040`, `CrossfeedPreset.Wide`) already carry their own
// namespace at the call site, so wrapping them in another would just
// double the prefix.
export * from './channels';
export * from './filter';
export * from './platform';
export * from './processing';
export * from './presetLimits';

// Function / type-heavy modules. No cross-module name collisions.
export * from './hardware';
export * from './mixer';
export * from './mixerView';
export * from './snapshot';
export * from './presetDiff';
export * from './presetDirectory';

// Note: `clamp.ts` is intentionally NOT re-exported here; import it directly
// (`from '@/domain/clamp'`) at the action boundary that owns the clamp gate.
