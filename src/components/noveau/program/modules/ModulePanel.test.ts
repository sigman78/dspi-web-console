import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { deriveCapabilities } from '@/protocol/capabilities';
import { Wire } from '@/protocol';
import { makeSnapshot } from '@test/fixtures/snapshotFixtures';
import { ChannelFamily, PlatformType, createHardwareProfile, type HardwareProfile } from '@/domain';
import { noveauUi } from '../../noveauUi.svelte';

const toggleLoudnessOutputChannel = vi.fn();
const toggleLevellerDetectorChannel = vi.fn();
const fetchSubharmSolo = vi.fn();

vi.mock('@/runtime', () => ({
  toggleLoudnessOutputChannel: (...a: unknown[]) => toggleLoudnessOutputChannel(...a),
  toggleLevellerDetectorChannel: (...a: unknown[]) => toggleLevellerDetectorChannel(...a),
  fetchSubharmSolo: (...a: unknown[]) => fetchSubharmSolo(...a),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

import ModulePanel from './ModulePanel.svelte';

const baseFeatures = deriveCapabilities({
  fw: { major: 1, minor: 1, patch: 6 }, wireVersion: 32, payloadLength: Wire.BULK_SIZE_V29, platformId: 1,
}).features;

function mount(overrides: Partial<typeof baseFeatures> = {}, activeInputChannels = 2, hw?: HardwareProfile) {
  const snapshot = makeSnapshot(undefined, hw);
  snapshot.loudness.enabled = true;
  snapshot.upmix.enabled = true;
  snapshot.subharm.enabled = true;
  const session = {
    device: { capabilities: { features: { ...baseFeatures, ...overrides } } },
    telemetry: {
      activeInputChannels, info: { sampleRateHz: 48000 }, limiterMeterDb: null,
      subharmSolo: false, subharmMeter: null, subharmHeadroomDb: null,
      wantSubharmMeter: vi.fn(() => vi.fn()),
    },
    mirror: { current: snapshot },
  } as unknown;
  return render(ModulePanel, { context: new Map([[SESSION_KEY, session]]) });
}

const sliders = (c: HTMLElement) => c.querySelectorAll('input[type="range"]').length;

describe('ModulePanel', () => {
  beforeEach(() => {
    toggleLoudnessOutputChannel.mockClear();
    toggleLevellerDetectorChannel.mockClear();
  });

  test('a loudness output chip toggles that output slot', async () => {
    noveauUi.programModule = 'loudness';
    const { container } = mount();
    const chips = container.querySelectorAll<HTMLButtonElement>('button[aria-label^="OUTPUTS "]');
    expect(chips.length).toBeGreaterThan(1);
    await fireEvent.click(chips[2]);
    expect(toggleLoudnessOutputChannel).toHaveBeenCalledTimes(1);
    expect(toggleLoudnessOutputChannel.mock.calls[0][1]).toBe(2);
  });

  test('a leveller detector chip toggles that input slot', async () => {
    noveauUi.programModule = 'leveller';
    const { container } = mount({ levellerMasks: true }, 8, createHardwareProfile(PlatformType.RP2350, ChannelFamily.Unified));
    const chips = container.querySelectorAll<HTMLButtonElement>('button[aria-label^="DETECTOR "]');
    expect(chips.length).toBeGreaterThan(2);
    await fireEvent.click(chips[2]);
    expect(toggleLevellerDetectorChannel).toHaveBeenCalledTimes(1);
    expect(toggleLevellerDetectorChannel.mock.calls[0][1]).toBe(2);
  });

  test('feature-gated upmix rows disappear with the flags', async () => {
    noveauUi.programModule = 'upmix';
    const full = mount();
    const withAll = sliders(full.container);
    expect(full.queryByLabelText('Upmix center presence')).toBeTruthy();
    expect(full.container.querySelectorAll('[aria-label="Upmix center mode"] [role="radio"]').length).toBe(3);
    full.unmount();

    const gated = mount({ upmixPresence: false, upmixCenterOff: false });
    await tick();
    expect(gated.queryByLabelText('Upmix center presence')).toBeNull();
    expect(sliders(gated.container)).toBe(withAll - 1);
    expect(gated.container.querySelectorAll('[aria-label="Upmix center mode"] [role="radio"]').length).toBe(2);
  });

  test('subharm shows the extended rows only with the V30 flag', () => {
    noveauUi.programModule = 'subharm';
    const ext = mount();
    expect(ext.queryByLabelText('Subharmonic 56 to 80 hertz band level')).toBeTruthy();
    expect(ext.queryByLabelText('Subharmonic selectivity depth')).toBeTruthy();
    expect(ext.queryByLabelText('Subharmonic sub ceiling')).toBeTruthy();
    ext.unmount();

    const base = mount({ subharmExt: false });
    expect(base.queryByLabelText('Subharmonic 56 to 80 hertz band level')).toBeNull();
    expect(base.queryByLabelText('Subharmonic selectivity depth')).toBeNull();
    expect(base.queryByLabelText('Subharmonic 24 to 36 hertz band level')).toBeTruthy();
  });

  test('a stored module the firmware lacks falls back to the first module', () => {
    noveauUi.programModule = 'psybass';
    const { container } = mount({ psybass: false });
    expect(container.querySelector('[aria-label="Master preamp"]')).toBeTruthy();
  });
});
