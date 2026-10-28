import { describe, test, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { deriveCapabilities } from '@/protocol/capabilities';
import { Wire } from '@/protocol';
import { makeSnapshot } from '@test/fixtures/snapshotFixtures';
import { noveauUi } from '@/components/noveau/noveauUi.svelte';

vi.mock('@/runtime', () => ({
  fetchSubharmSolo: vi.fn(),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

import ModulePanel from './ModulePanel.svelte';

const features = deriveCapabilities({
  fw: { major: 1, minor: 1, patch: 6 }, wireVersion: 32, payloadLength: Wire.BULK_SIZE_V29, platformId: 1,
}).features;

type Gate = 'leveller' | 'crossfeed' | 'loudness' | 'psybass' | 'subharm' | 'upmix';
const GATES: Gate[] = ['leveller', 'crossfeed', 'loudness', 'psybass', 'subharm', 'upmix'];

function mount(module: Gate, enabled: boolean) {
  const snapshot = makeSnapshot();
  snapshot[module].enabled = enabled;
  const session = {
    device: { capabilities: { features } },
    telemetry: {
      activeInputChannels: 2, info: { sampleRateHz: 48000 }, limiterMeterDb: null,
      subharmSolo: false, subharmMeter: null, subharmHeadroomDb: null,
      wantSubharmMeter: vi.fn(() => vi.fn()),
    },
    mirror: { current: snapshot },
  } as unknown;
  noveauUi.programModule = module;
  return render(ModulePanel, { context: new Map([[SESSION_KEY, session]]) });
}

describe('module gate reasons', () => {
  test.each(GATES)('%s off: the body is inert and a gated control is described by the reason', (module) => {
    const { container } = mount(module, false);
    expect(container.querySelector('.body.off')).toBeTruthy();
    expect(container.querySelector('.reason')).toBeNull();
    const gated = container.querySelector<HTMLElement>('input[type="range"][aria-describedby], [role="radiogroup"][aria-describedby]')!;
    expect(gated).toBeTruthy();
    const described = container.ownerDocument.getElementById(gated.getAttribute('aria-describedby')!);
    expect(described?.textContent).toMatch(/is off/);
  });

  test.each([
    ['crossfeed', 'Crossfeed cutoff frequency', 'Crossfeed preset'],
    ['subharm', 'Subharmonic selectivity depth', 'Subharmonic selectivity mode'],
  ] as const)('%s on: only the sub-gated control is described', (module, gatedLabel, freeLabel) => {
    const { container } = mount(module, true);
    expect(container.querySelector('.reason')).toBeNull();
    expect(container.querySelector(`[aria-label="${gatedLabel}"]`)!.getAttribute('aria-describedby')).toBeTruthy();
    expect(container.querySelector(`[aria-label="${freeLabel}"]`)!.getAttribute('aria-describedby')).toBeNull();
  });

  test('a gated switch stays focusable and inert, described by the reason', () => {
    const { container } = mount('crossfeed', false);
    const itd = container.querySelector<HTMLButtonElement>('button[aria-label="Crossfeed ITD"]')!;
    expect(itd.disabled).toBe(false);
    expect(itd.getAttribute('aria-disabled')).toBe('true');
    expect(container.ownerDocument.getElementById(itd.getAttribute('aria-describedby')!)?.textContent).toMatch(/is off/);
  });
});
