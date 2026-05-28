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

  // Granular (latency-sensitive, per-band scrub; glitch-free audio). Trailing resync.
  eqFilter:          { strategy: 'granular', converge: 'resync' },
  bypass:            { strategy: 'granular', converge: 'resync' },
  channelName:       { strategy: 'granular', converge: 'resync' },
  loudnessEnabled:   { strategy: 'granular', converge: 'resync' },
  crossfeedEnabled:  { strategy: 'granular', converge: 'resync' },
  crossfeedPreset:   { strategy: 'granular', converge: 'resync' },
  crossfeedItd:      { strategy: 'granular', converge: 'resync' },
  levellerEnabled:   { strategy: 'granular', converge: 'resync' },
  levellerSpeed:     { strategy: 'granular', converge: 'resync' },
  levellerLookahead: { strategy: 'granular', converge: 'resync' },
  outputDelay:       { strategy: 'granular', converge: 'resync' },
  outputEnabled:     { strategy: 'granular', converge: 'resync' },
  outputMuted:       { strategy: 'granular', converge: 'resync' },

  // Granular (latency-sensitive, numeric sliders; glitch-free audio). Trailing resync.
  loudnessRefSpl:    { strategy: 'granular', converge: 'resync' },
  loudnessIntensity: { strategy: 'granular', converge: 'resync' },
  crossfeedFreq:     { strategy: 'granular', converge: 'resync' },
  crossfeedFeedDb:   { strategy: 'granular', converge: 'resync' },
  levellerAmount:    { strategy: 'granular', converge: 'resync' },
  levellerMaxGain:   { strategy: 'granular', converge: 'resync' },
  levellerGate:      { strategy: 'granular', converge: 'resync' },
} as const satisfies Record<string, ControlPolicy>;

export type ControlName = keyof typeof CONTROL_POLICY;
