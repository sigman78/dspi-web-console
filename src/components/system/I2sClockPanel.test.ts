import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

vi.mock('@/runtime', () => ({
  setI2sBckPin: vi.fn(), setMckEnabled: vi.fn(), setMckPin: vi.fn(), setMckMultiplier: vi.fn(),
}));

vi.mock('@/state', () => {
  const snap = {
    platform: { type: 1 /* PlatformType.RP2350 */, name: 'RP2350', outputCount: 9, totalChannelCount: 11, pdmOutputIndex: 8 },
    outputPins: [6, 7, 8, 9, 10],
    i2s: { outputSlotTypes: [0, 0, 0, 0], bckPin: 14, mckPin: 13, mckEnabled: false, mckMultiplierEncoded: 0 },
  };
  return {
    mirror: { get current() { return snap; } },
    session: { get status() { return 'connected'; } },
    status: { get info() { return { sampleRateHz: 96000 }; } },
  };
});

import I2sClockPanel from './I2sClockPanel.svelte';

describe('I2sClockPanel', () => {
  test('256x multiplier option is disabled at 96 kHz', () => {
    render(I2sClockPanel);
    const opt256 = screen.getByRole('radio', { name: '256×' });
    expect(opt256.hasAttribute('disabled')).toBe(true);
  });

  test('LRCLK is shown as BCK + 1', () => {
    render(I2sClockPanel);
    expect(screen.getByText('LRCLK GP15')).toBeTruthy();
  });
});
