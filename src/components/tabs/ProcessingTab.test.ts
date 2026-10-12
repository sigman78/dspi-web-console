import { describe, test, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { deriveCapabilities, type DeviceFeatures } from '@/protocol/capabilities';
import { Wire } from '@/protocol';
import { makeSnapshot } from '@test/fixtures/snapshotFixtures';

// Crossfeed/Loudness's BodePlot measures its container via bind:clientWidth
// (ResizeObserver); jsdom doesn't implement it.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

// Mocks every action the six rendered panels (Crossfeed/Loudness/Leveller/
// Psybass/Subharm/Upmix) pull from '@/runtime' -- none is exercised here,
// this test only checks what renders and where.
vi.mock('@/runtime', () => ({
  setCrossfeedEnabled: vi.fn(), setCrossfeedPreset: vi.fn(), setCrossfeedItd: vi.fn(),
  setCrossfeedFreq: vi.fn(), setCrossfeedFeedDb: vi.fn(), toggleCrossfeedOutputPair: vi.fn(),
  setLoudnessEnabled: vi.fn(), setLoudnessRefSpl: vi.fn(), setLoudnessIntensityPct: vi.fn(), toggleLoudnessOutputChannel: vi.fn(),
  setLevellerEnabled: vi.fn(), setLevellerSpeed: vi.fn(), setLevellerLookahead: vi.fn(),
  setLevellerAmount: vi.fn(), setLevellerMaxGain: vi.fn(), setLevellerGate: vi.fn(),
  setLevellerMasks: vi.fn(), toggleLevellerDetectorChannel: vi.fn(), toggleLevellerApplyChannel: vi.fn(),
  setPsybassEnabled: vi.fn(), setPsybassCutoff: vi.fn(), setPsybassHarmonics: vi.fn(),
  setPsybassDrive: vi.fn(), setPsybassCharacter: vi.fn(), setPsybassOriginal: vi.fn(), togglePsybassOutputChannel: vi.fn(),
  setSubharmEnabled: vi.fn(), setSubharmLow: vi.fn(), setSubharmHigh: vi.fn(), setSubharmBoost: vi.fn(),
  toggleSubharmOutputChannel: vi.fn(), reserveSubharmHeadroom: vi.fn(),
  setLimiterAllEnabled: vi.fn(), setLimiterEnabled: vi.fn(), setLimiterThreshold: vi.fn(),
  setLimiterRelease: vi.fn(), setLimiterLinkGroup: vi.fn(),
  setUpmixEnabled: vi.fn(), setUpmixCenterMode: vi.fn(), setUpmixSurroundMode: vi.fn(),
  setUpmixStrength: vi.fn(), setUpmixCenterWidth: vi.fn(), setUpmixPresence: vi.fn(),
  setUpmixCorrThreshold: vi.fn(), setUpmixAttack: vi.fn(), setUpmixRelease: vi.fn(), setUpmixDetectorHpf: vi.fn(),
  setUpmixSurroundDelay: vi.fn(), setUpmixSurroundHpf: vi.fn(), setUpmixSurroundLpf: vi.fn(), setUpmixDecorr: vi.fn(),
}));

const connectionState = vi.hoisted(() => ({ connected: true, phase: 'ready' }));
vi.mock('@/state', () => ({
  connection: connectionState,
}));

import ProcessingTab from './ProcessingTab.svelte';

// wireVersion 29 (the max known wire) turns on every gated feature the six
// panels check, so "all features on" is a one-line derivation, not a
// hand-typed flag list.
const ALL_FEATURES = deriveCapabilities({
  fw: { major: 1, minor: 1, patch: 6 }, wireVersion: 29, payloadLength: Wire.BULK_SIZE_V29, platformId: 1,
}).features;

function makeSession(featureOverrides: Partial<DeviceFeatures> = {}) {
  return {
    device: { capabilities: { features: { ...ALL_FEATURES, ...featureOverrides } } },
    telemetry: {
      activeInputChannels: null, subharmHeadroomDb: null, info: null,
      limiterMeterDb: null, limiterStatus: null, wantLimiterMeter: vi.fn(() => vi.fn()),
    },
    mirror: { current: makeSnapshot() },
    presets: { directory: null },
  } as unknown;
}

function renderTab(session: unknown) {
  return render(ProcessingTab, { context: new Map([[SESSION_KEY, session]]) });
}

describe('ProcessingTab', () => {
  const columnTitles = (container: HTMLElement) =>
    [...container.querySelectorAll('.col')].map((col) => [...col.querySelectorAll('.panel .title')].map((e) => e.textContent));

  test('balances the columns: CROSSFEED + LEVELLER + PSYBASS | LOUDNESS + SUBHARMONIC | STEREO UPMIXER + LIMITER', () => {
    const { container } = renderTab(makeSession({ limiter: true }));
    expect(columnTitles(container)).toEqual([
      ['CROSSFEED', 'LEVELLER', 'PSYBASS'],
      ['LOUDNESS', 'SUBHARMONIC'],
      ['STEREO UPMIXER', 'LIMITER'],
    ]);
  });

  test('gated panels drop out of their columns on an RP2040-shaped profile', () => {
    const { container } = renderTab(makeSession({ upmix: false, psybass: false, limiter: true }));
    expect(columnTitles(container)).toEqual([
      ['CROSSFEED', 'LEVELLER'],
      ['LOUDNESS', 'SUBHARMONIC'],
      ['LIMITER'],
    ]);
  });

  test('renders SUBHARMONIC (PR.06) when features.subharm is true', () => {
    const { getByText } = renderTab(makeSession({ subharm: true }));
    expect(getByText('SUBHARMONIC')).toBeTruthy();
  });

  test('does not render SUBHARMONIC (PR.06) when features.subharm is false', () => {
    const { queryByText } = renderTab(makeSession({ subharm: false }));
    expect(queryByText('SUBHARMONIC')).toBeNull();
  });

  test('renders LIMITER (PR.07) only when features.limiter is true', () => {
    const on = renderTab(makeSession({ limiter: true }));
    expect(on.getByText('LIMITER')).toBeTruthy();
    on.unmount();

    const off = renderTab(makeSession({ limiter: false }));
    expect(off.queryByText('LIMITER')).toBeNull();
  });
});
