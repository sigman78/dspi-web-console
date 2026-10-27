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
const setCrosspointGain = vi.fn();
const setCrosspointInvert = vi.fn();
const routeCrosspoint = vi.fn();

vi.mock('@/runtime', () => ({
  setCrosspointEnabled: (...a: unknown[]) => setCrosspointEnabled(...a),
  setCrosspointGain: (...a: unknown[]) => setCrosspointGain(...a),
  setCrosspointInvert: (...a: unknown[]) => setCrosspointInvert(...a),
  routeCrosspoint: (...a: unknown[]) => routeCrosspoint(...a),
}));

import RoutingMap from './RoutingMap.svelte';

const features = deriveCapabilities({
  fw: { major: 1, minor: 1, patch: 6 }, wireVersion: 32, payloadLength: Wire.BULK_SIZE_V29, platformId: 1,
}).features;

const unroutedDot = (c: HTMLElement) =>
  [...c.querySelectorAll<HTMLButtonElement>('.cell.off .dotbtn')].find((b) => b.getAttribute('aria-label')!.endsWith('unrouted'))!;

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
  beforeEach(() => {
    setCrosspointEnabled.mockClear();
    setCrosspointGain.mockClear();
    setCrosspointInvert.mockClear();
    routeCrosspoint.mockClear();
  });

  test('a disabled output keeps a hatched row with its real route pill', () => {
    const { container } = mount();
    const hatched = container.querySelectorAll('.band');
    expect(hatched).toHaveLength(1);
    const pills = container.querySelectorAll('.cell.off .pill');
    expect(pills).toHaveLength(1);
    expect(pills[0].textContent).toContain('−4.5');
  });

  test('an unrouted dot opens a proposal and writes nothing until ROUTE', async () => {
    const { container, getByRole, getByText, queryByRole, session, off } = mount();
    await fireEvent.click(unroutedDot(container));
    expect(getByRole('dialog')).toBeTruthy();
    expect(container.querySelector('.dotbtn.proposed')).toBeTruthy();
    expect(setCrosspointEnabled).not.toHaveBeenCalled();

    await fireEvent.click(getByRole('switch', { name: 'Invert phase' }));
    expect(setCrosspointInvert).not.toHaveBeenCalled();
    await fireEvent.click(getByText('ROUTE'));

    expect(routeCrosspoint).toHaveBeenCalledTimes(1);
    const [sess, input, output, draft] = routeCrosspoint.mock.calls[0];
    expect(sess).toBe(session);
    expect(typeof input).toBe('number');
    expect(output).toBe(off.wireIndex);
    expect(draft).toEqual({ gainDb: 0, invert: true });
    expect(setCrosspointGain).not.toHaveBeenCalled();
    expect(setCrosspointInvert).not.toHaveBeenCalled();
    expect(setCrosspointEnabled).not.toHaveBeenCalled();
    expect(queryByRole('dialog')).toBeNull();
  });

  test('Escape and CANCEL close a proposal without any write', async () => {
    const { container, getByText, queryByRole } = mount();
    await fireEvent.click(unroutedDot(container));
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(queryByRole('dialog')).toBeNull();
    await fireEvent.click(unroutedDot(container));
    await fireEvent.click(getByText('CANCEL'));
    expect(queryByRole('dialog')).toBeNull();
    expect(setCrosspointEnabled).not.toHaveBeenCalled();
    expect(setCrosspointInvert).not.toHaveBeenCalled();
    expect(setCrosspointGain).not.toHaveBeenCalled();
  });

  test('UNROUTE disables the route and closes the popover', async () => {
    const { container, getByText, queryByRole, off } = mount();
    const dot = [...container.querySelectorAll<HTMLButtonElement>('.cell.off .dotbtn')].find((b) => !b.getAttribute('aria-label')!.endsWith('unrouted'))!;
    await fireEvent.click(dot);
    expect(container.querySelector('.dotbtn.proposed')).toBeNull();
    expect(setCrosspointEnabled).not.toHaveBeenCalled();
    await fireEvent.click(getByText('UNROUTE'));
    expect(setCrosspointEnabled.mock.calls[0].slice(2)).toEqual([off.wireIndex, false]);
    expect(queryByRole('dialog')).toBeNull();
  });

  test('opening another dot resets the popover to that dot', async () => {
    const { container, getByRole } = mount();
    const live = [...container.querySelectorAll<HTMLButtonElement>('.cell.off .dotbtn')].find((b) => !b.getAttribute('aria-label')!.endsWith('unrouted'))!;
    await fireEvent.click(live);
    const titleA = getByRole('dialog').getAttribute('aria-label');
    await fireEvent.click(unroutedDot(container));
    const dlg = getByRole('dialog');
    expect(dlg.getAttribute('aria-label')).not.toBe(titleA);
    expect(dlg.querySelector('.cap')!.textContent).toContain('new route');
    expect(getByRole('switch', { name: 'Invert phase' }).getAttribute('aria-checked')).toBe('false');
    expect(dlg.textContent).toContain('0.0');
    expect(dlg.textContent).not.toContain('4.5');
  });
});
