import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const verbs = vi.hoisted(() => ({
  setOutputType: vi.fn(async () => ({ ok: true, value: undefined })),
  setOutputDataPin: vi.fn(async () => ({ ok: true, value: undefined })),
}));
vi.mock('@/runtime', () => verbs);

vi.mock('@/state', () => {
  const snap = {
    platform: { type: 1 /* PlatformType.RP2350 */, name: 'RP2350', outputCount: 9, totalChannelCount: 11, pdmOutputIndex: 8 },
    outputs: [{ wireIndex: 8, enabled: false }],
    outputPins: [6, 7, 8, 9, 10],
    i2s: { outputSlotTypes: [0, 0, 0, 0], bckPin: 14, mckPin: 13, mckEnabled: false, mckMultiplierEncoded: 0 },
  };
  return { mirror: { get current() { return snap; } }, session: { get status() { return 'connected'; } } };
});

import OutputsPanel from './OutputsPanel.svelte';

beforeEach(() => { verbs.setOutputType.mockClear(); verbs.setOutputDataPin.mockClear(); });

describe('OutputsPanel', () => {
  test('switching a slot type calls setOutputType(slot, type)', async () => {
    render(OutputsPanel);
    const i2s = screen.getAllByRole('radio', { name: 'I2S' })[0];
    await fireEvent.click(i2s);
    expect(verbs.setOutputType).toHaveBeenCalledWith(0, 1);
  });
});
