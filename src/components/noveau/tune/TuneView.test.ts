import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { deriveCapabilities } from '@/protocol/capabilities';
import { Wire } from '@/protocol';
import { noveauUi } from '@/components/noveau/noveauUi.svelte';
import { settings, createEqLinkState } from '@/state';
import { defaultEqLinkGroups } from '@/domain';
import { makeSnapshot } from '@test/fixtures/snapshotFixtures';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

import TuneView from './TuneView.svelte';

const features = deriveCapabilities({
  fw: { major: 1, minor: 1, patch: 6 }, wireVersion: 29, payloadLength: Wire.BULK_SIZE_V29, platformId: 1,
}).features;

function mount(snapshot = makeSnapshot()) {
  const session = {
    device: { capabilities: { features } },
    telemetry: {
      activeInputChannels: null, info: null, limiterMeterDb: null, limiterStatus: null,
      wantLimiterMeter: vi.fn(() => vi.fn()),
    },
    mirror: { current: snapshot },
    eqLink: createEqLinkState('TEST', () => defaultEqLinkGroups(snapshot.channels, snapshot.inputConfig.source, null)),
    presets: { directory: null },
  } as unknown;
  return render(TuneView, { context: new Map([[SESSION_KEY, session]]) });
}

describe('TuneView', () => {
  beforeEach(() => {
    settings.selectedChannel = null;
    noveauUi.selectedBand = null;
  });

  test('a disabled output still shows its real crosspoints', () => {
    const snap = makeSnapshot();
    const out = snap.outputs[0];
    out.enabled = false;
    snap.routes = snap.routes.map((r) =>
      r.outputWireIndex === out.wireIndex ? { ...r, enabled: r.inputIndex === 0 } : r,
    );
    settings.selectedChannel = out.id;
    const { container, getByText } = mount(snap);
    expect(getByText('output disabled')).toBeTruthy();
    const on = container.querySelectorAll('[aria-label^="Route "][aria-checked="true"]');
    expect(on.length).toBe(1);
  });
});
