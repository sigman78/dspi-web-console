import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { deriveCapabilities } from '@/protocol/capabilities';
import { Wire } from '@/protocol';
import { FilterType, type FilterParams } from '@/domain';
import { makeSnapshot } from '@test/fixtures/snapshotFixtures';
import { noveauUi } from '../noveauUi.svelte';
import { bandDraft, bandHold, holdBand } from './bandDraft.svelte';

const setEqFilter = vi.hoisted(() => vi.fn());
const setBandBypass = vi.hoisted(() => vi.fn());
vi.mock('@/runtime', async (orig) => ({ ...(await orig<typeof import('@/runtime')>()), setEqFilter, setBandBypass }));

import BandSection from './BandSection.svelte';

const features = deriveCapabilities({
  fw: { major: 1, minor: 1, patch: 6 }, wireVersion: 29, payloadLength: Wire.BULK_SIZE_V29, platformId: 1,
}).features;

describe('BandSection', () => {
  beforeEach(() => {
    setEqFilter.mockClear();
    setBandBypass.mockClear();
    bandDraft.current = null;
    bandHold.release();
  });

  it('a gain commit carries a frequency write the mirror has not acknowledged yet', async () => {
    const snap = makeSnapshot();
    const channel = snap.channels.find((c) => !c.isOutput)!;
    const original: FilterParams = { ...channel.filters[0], type: FilterType.Peaking, frequency: 1000, gain: 0, q: 1, bypass: false };
    channel.filters[0] = original;
    const session = {
      device: { capabilities: { features } },
      mirror: { current: snap },
    } as never;
    noveauUi.selectedBand = 0;

    holdBand(session, { channelId: channel.id, kind: 'peq', index: 0, band: { ...original, frequency: 2000 } });

    const { container } = render(BandSection, { props: { channel }, context: new Map([[SESSION_KEY, session]]) });
    const ranges = container.querySelectorAll('input[type="range"]');
    const gain = ranges[1];
    await fireEvent.pointerDown(gain);
    await fireEvent.input(gain, { target: { value: '3' } });
    window.dispatchEvent(new Event('pointerup'));

    expect(setEqFilter).toHaveBeenCalledTimes(1);
    expect(setEqFilter.mock.calls[0][3]).toMatchObject({ frequency: 2000, gain: 3 });
  });

  it('the inspector bypass is one pressed icon button that writes the toggled flag', async () => {
    const snap = makeSnapshot();
    const channel = snap.channels.find((c) => !c.isOutput)!;
    channel.filters[0] = { ...channel.filters[0], type: FilterType.Peaking, bypass: false };
    const session = { device: { capabilities: { features } }, mirror: { current: snap } } as never;
    noveauUi.selectedBand = 0;

    const { getByRole, queryByRole } = render(BandSection, { props: { channel }, context: new Map([[SESSION_KEY, session]]) });
    expect(queryByRole('switch')).toBeNull();
    const btn = getByRole('button', { name: 'Bypass band' });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    await fireEvent.click(btn);

    expect(setBandBypass).toHaveBeenCalledWith(session, channel.id, 0, true);
  });
});
