// Wire-format codec schemas — namespaced.  Callers use `Wire.Header`,
// `Wire.BulkParams`, `Wire.BandParams`, etc.  Matches the established
// `import * as Wire from './wireTypes'` convention inside the protocol
// directory.
export * as Wire from './wireTypes';

// Public-surface enums and small constants from wireTypes that callers
// reach for as bare names (not codec internals): startup mode, status
// channel ids, preset-directory codec + its request size.  Exposing them
// flat avoids forcing `Wire.PresetStartupMode.Specified` everywhere.
export {
  PresetStartupMode,
  SystemStatusValue,
  PresetDirectory,
  PresetDirRequestSize,
} from './wireTypes';

// Parser interfaces + functions (one DTO + one parse function per file)
export * from './bulkParser';
export * from './bufferStats';
export * from './systemStatus';
export * from './systemInfo';

// Vendor-request descriptors (WireCmd const) + helpers (readCmd / writeCmd)
export * from './wireCmd';

// Result-code enums (FlashResult, PresetResult) + byte-decoder helpers
export * from './results';
