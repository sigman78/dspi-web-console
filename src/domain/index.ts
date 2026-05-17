// Constants-heavy modules — exposed as namespaces (matches existing
// `import * as Eq` / `import * as Mix` convention; lets callers reach
// for `Eq.FREQ_MIN_HZ` and `Mix.OUTPUT_GAIN_MAX_DB` without flooding
// the local scope with a dozen bare constants).
export * as Eq from './eqLimits';
export * as Mix from './mixerLimits';

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
export * from './bulkToSnapshot';
export * from './presetDiff';
export * from './presetDirectory';

// Note: `validation.ts` is intentionally NOT re-exported here. It exports
// `ok` and `fail` helpers that would shadow the `Result.ok` / `Result.fail`
// namespace from `../utils`. Import direct: `from '../domain/validation'`.
