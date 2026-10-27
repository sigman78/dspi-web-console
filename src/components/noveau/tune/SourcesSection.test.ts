import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { deriveCapabilities } from '@/protocol/capabilities';
import { Wire } from '@/protocol';
import { inputIndexOf } from '@/domain';
import { makeSnapshot } from '@test/fixtures/snapshotFixtures';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

const setCrosspointEnabled = vi.fn();
const routeCrosspoint = vi.fn();

vi.mock('@/runtime', () => ({
  setCrosspointEnabled: (...a: unknown[]) => setCrosspointEnabled(...a),
  setCrosspointGain: vi.fn(),
  setCrosspointInvert: vi.fn(),
  routeCrosspoint: (...a: unknown[]) => routeCrosspoint(...a),
}));

import SourcesSection from './SourcesSection.svelte';

const features = deriveCapabilities({
  fw: { major: 1, minor: 1, patch: 6 }, wireVersion: 32, payloadLength: Wire.BULK_SIZE_V29, platformId: 1,
}).features;

function mount() {
  const snapshot = makeSnapshot();
  for (const o of snapshot.outputs) o.enabled = true;
  const channel = snapshot.channels.find((c) => !c.isOutput)!;
  const slot = inputIndexOf(channel.id)!;
  const mine = snapshot.routes.filter((r) => r.inputIndex === slot);
  mine[0].enabled = true;
  mine[1].enabled = false;
  const session = {
    device: { capabilities: { features } },
    telemetry: { activeInputChannels: 2, info: { sampleRateHz: 48000 } },
    mirror: { current: snapshot },
  } as unknown;
  const view = render(SourcesSection, { props: { channel, output: null }, context: new Map([[SESSION_KEY, session]]) });
  return { ...view, session, slot, live: mine[0], unrouted: mine[1] };
}

describe('SourcesSection', () => {
  beforeEach(() => {
    setCrosspointEnabled.mockClear();
    routeCrosspoint.mockClear();
  });

  test('an unrouted row opens a proposal that creates the route on ROUTE', async () => {
    const { container, getByRole, getByText, queryByRole, session, slot, unrouted } = mount();
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('.edit')];
    const btn = buttons.find((b) => b.title === 'Add route')!;
    await fireEvent.click(btn);
    expect(getByRole('dialog')).toBeTruthy();
    expect(routeCrosspoint).not.toHaveBeenCalled();

    await fireEvent.click(getByText('ROUTE'));
    expect(routeCrosspoint).toHaveBeenCalledWith(session, slot, unrouted.outputWireIndex, { gainDb: 0, invert: false });
    expect(queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  test('a routed row opens live editing with UNROUTE', async () => {
    const { container, getByText, live } = mount();
    const btn = [...container.querySelectorAll<HTMLButtonElement>('.edit')].find((b) => b.title === 'Edit route')!;
    await fireEvent.click(btn);
    await fireEvent.click(getByText('UNROUTE'));
    expect(setCrosspointEnabled.mock.calls[0].slice(2)).toEqual([live.outputWireIndex, false]);
  });
});
