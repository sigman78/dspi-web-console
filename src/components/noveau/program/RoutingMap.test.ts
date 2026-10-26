import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { deriveCapabilities } from '@/protocol/capabilities';
import { Wire } from '@/protocol';
import { makeSnapshot } from '@test/fixtures/snapshotFixtures';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

const setCrosspointEnabled = vi.fn();

vi.mock('@/runtime', () => ({
  setCrosspointEnabled: (...a: unknown[]) => setCrosspointEnabled(...a),
  setCrosspointGain: vi.fn(),
  setCrosspointInvert: vi.fn(),
}));

import RoutingMap from './RoutingMap.svelte';

const features = deriveCapabilities({
  fw: { major: 1, minor: 1, patch: 6 }, wireVersion: 32, payloadLength: Wire.BULK_SIZE_V29, platformId: 1,
}).features;

const unroutedDot = (c: HTMLElement) =>
  [...c.querySelectorAll<HTMLButtonElement>('.cell.hatch .dotbtn')].find((b) => b.getAttribute('aria-label')!.endsWith('unrouted'))!;

function mount() {
  const snapshot = makeSnapshot();
  const off = [...snapshot.outputs].sort((a, b) => a.wireIndex - b.wireIndex).at(-1)!;
  for (const o of snapshot.outputs) o.enabled = true;
  off.enabled = false;
  const route = snapshot.routes.find((r) => r.outputWireIndex === off.wireIndex)!;
  route.enabled = true;
  route.gainDb = -4.5;
  const session = {
    device: { capabilities: { features } },
    telemetry: { activeInputChannels: 2, info: { sampleRateHz: 48000 } },
    mirror: { current: snapshot },
  } as unknown;
  const view = render(RoutingMap, { context: new Map([[SESSION_KEY, session]]) });
  return { ...view, session, route, off };
}

describe('RoutingMap', () => {
  beforeEach(() => setCrosspointEnabled.mockClear());

  test('a disabled output keeps a hatched row with its real route pill', () => {
    const { container } = mount();
    const hatched = container.querySelectorAll('.rh.hatch');
    expect(hatched).toHaveLength(1);
    const pills = container.querySelectorAll('.cell.hatch .pill');
    expect(pills).toHaveLength(1);
    expect(pills[0].textContent).toContain('−4.5');
  });

  test('a disabled route offers ENABLE but locks GAIN and PHASE', async () => {
    const { container, getByRole, getByLabelText } = mount();
    await fireEvent.click(unroutedDot(container));
    const dialog = getByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(getByLabelText('Invert phase').hasAttribute('disabled')).toBe(true);
    expect(dialog.querySelector('input[type="range"]')?.hasAttribute('disabled')).toBe(true);
  });

  test('ENABLE routes the clicked input to the clicked output slot', async () => {
    const { container, getByLabelText, session, off } = mount();
    await fireEvent.click(unroutedDot(container));
    await fireEvent.click(getByLabelText('Route enabled'));
    expect(setCrosspointEnabled).toHaveBeenCalledTimes(1);
    const [sess, input, output, on] = setCrosspointEnabled.mock.calls[0];
    expect(sess).toBe(session);
    expect(output).toBe(off.wireIndex);
    expect(typeof input).toBe('number');
    expect(on).toBe(true);
  });
});
