// Synthesizer barrel — wire-format encoders for test data + mock transport.
// Kept separate from the main `protocol/index.ts` barrel so prod code paths
// can't accidentally pull synthesizer surface; consumers (MockTransport,
// tests) opt in explicitly via `from '../protocol/syn'`.
export * from './bulkParser.syn';
export * from './bufferStats.syn';
export * from './systemStatus.syn';
