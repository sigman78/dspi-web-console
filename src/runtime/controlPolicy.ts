// Declarative write policy per control. The unified outbox reads this
// to route a write to the granular (per-item, glitch-free) or bulk (SetAllParams)
// path, and to decide convergence: granular writes schedule a trailing resync;
// bulk writes self-converge from the packet they sent.
export type WriteStrategy = 'granular' | 'bulk';
export type Convergence = 'resync' | 'self';

export interface ControlPolicy {
  strategy: WriteStrategy;
  converge: Convergence;
  debounceMs?: number; // bulk only: defer the flush until the key is idle this long
}

export const CONTROL_POLICY = {
  // Granular (latency-sensitive, per-item scrub; glitch-free audio). Trailing resync.
  masterVolume: { strategy: 'granular', converge: 'resync' },
  masterPreamp: { strategy: 'granular', converge: 'resync' },
  inputPreamp:  { strategy: 'granular', converge: 'resync' },
  crosspoint:   { strategy: 'granular', converge: 'resync' },
  outputGain:   { strategy: 'granular', converge: 'resync' },

  // Bulk immediate (SetAllParams; self-converging).
  eqFilter:          { strategy: 'bulk', converge: 'self' },
  bypass:            { strategy: 'granular', converge: 'resync' },
  channelName:       { strategy: 'bulk', converge: 'self' },
  loudnessEnabled:   { strategy: 'granular', converge: 'resync' },
  crossfeedEnabled:  { strategy: 'granular', converge: 'resync' },
  crossfeedPreset:   { strategy: 'granular', converge: 'resync' },
  crossfeedItd:      { strategy: 'granular', converge: 'resync' },
  levellerEnabled:   { strategy: 'granular', converge: 'resync' },
  levellerSpeed:     { strategy: 'granular', converge: 'resync' },
  levellerLookahead: { strategy: 'granular', converge: 'resync' },
  outputDelay:       { strategy: 'bulk', converge: 'self' },
  outputEnabled:     { strategy: 'bulk', converge: 'self' },
  outputMuted:       { strategy: 'bulk', converge: 'self' },

  // Bulk debounced (16 ms trailing — rare numeric sliders).
  loudnessRefSpl:    { strategy: 'bulk', converge: 'self', debounceMs: 16 },
  loudnessIntensity: { strategy: 'bulk', converge: 'self', debounceMs: 16 },
  crossfeedFreq:     { strategy: 'bulk', converge: 'self', debounceMs: 16 },
  crossfeedFeedDb:   { strategy: 'bulk', converge: 'self', debounceMs: 16 },
  levellerAmount:    { strategy: 'bulk', converge: 'self', debounceMs: 16 },
  levellerMaxGain:   { strategy: 'bulk', converge: 'self', debounceMs: 16 },
  levellerGate:      { strategy: 'bulk', converge: 'self', debounceMs: 16 },
} as const satisfies Record<string, ControlPolicy>;

export type ControlName = keyof typeof CONTROL_POLICY;
