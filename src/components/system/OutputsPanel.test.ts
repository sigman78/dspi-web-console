import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';

const verbs = vi.hoisted(() => ({
  setOutputType: vi.fn(async () => {}),
  setOutputDataPin: vi.fn(async () => {}),
}));
vi.mock('@/runtime', () => verbs);

vi.mock('@/state', () => ({
  connection: { get connected() { return true; }, get phase() { return 'ready'; } },
}));

import OutputsPanel from './OutputsPanel.svelte';

const snap = {
  platform: { type: 1 /* PlatformType.RP2350 */, name: 'RP2350', outputCount: 9, totalChannelCount: 11, pdmOutputIndex: 8 },
  outputs: [{ wireIndex: 8, enabled: false }],
  outputPins: [6, 7, 8, 9, 10],
  i2s: { outputSlotTypes: [0, 0, 0, 0], bckPin: 14, mckPin: 13, mckEnabled: false, mckMultiplierEncoded: 0 },
};

const session = {
  mirror: { current: snap },
  presets: { directory: null },
  device: { capabilities: { features: { outputConfigSave: false } } },
} as any;

beforeEach(() => { verbs.setOutputType.mockClear(); verbs.setOutputDataPin.mockClear(); });

describe('OutputsPanel', () => {
  test('switching a slot type calls setOutputType(s, slot, type)', async () => {
    render(OutputsPanel, { context: new Map([[SESSION_KEY, session]]) });
    const i2s = screen.getAllByRole('radio', { name: 'I2S' })[0];
    await fireEvent.click(i2s);
    expect(verbs.setOutputType).toHaveBeenCalledWith(session, 0, 1);
  });
});
