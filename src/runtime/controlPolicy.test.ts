import { describe, it, expect } from 'vitest';
import { CONTROL_POLICY, type ControlPolicy } from './controlPolicy';

// Helper: read an entry through the ControlPolicy interface so that optional
// fields (debounceMs) are visible to the type-checker regardless of const narrowing.
const pol = (k: keyof typeof CONTROL_POLICY): ControlPolicy => CONTROL_POLICY[k];

describe('CONTROL_POLICY', () => {
  it('granular controls converge via resync with no debounce', () => {
    for (const k of ['masterVolume','masterPreamp','inputPreamp','crosspoint','outputGain'] as const) {
      expect(pol(k)).toMatchObject({ strategy: 'granular', converge: 'resync' });
      expect(pol(k).debounceMs).toBeUndefined();
    }
  });
  it('bulk immediate controls self-converge with no debounce', () => {
    for (const k of ['eqFilter','bypass','channelName','outputDelay','outputEnabled','outputMuted','loudnessEnabled','crossfeedPreset','levellerSpeed'] as const) {
      expect(pol(k)).toMatchObject({ strategy: 'bulk', converge: 'self' });
      expect(pol(k).debounceMs).toBeUndefined();
    }
  });
  it('bulk debounced controls use 16ms', () => {
    for (const k of ['loudnessRefSpl','loudnessIntensity','crossfeedFreq','crossfeedFeedDb','levellerAmount','levellerMaxGain','levellerGate'] as const) {
      expect(CONTROL_POLICY[k]).toMatchObject({ strategy: 'bulk', converge: 'self', debounceMs: 16 });
    }
  });
  it('every entry is internally consistent (granular=>resync, bulk=>self)', () => {
    for (const [, p] of Object.entries(CONTROL_POLICY)) {
      if (p.strategy === 'granular') expect(p.converge).toBe('resync');
      else expect(p.converge).toBe('self');
    }
  });
});
