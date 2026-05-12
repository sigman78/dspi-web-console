// Component-level test for ValueField's pin-at-beginEdit contract.
// The reactive snapshot replacement during a 250 ms resync had been
// turning into a silent no-op when the user typed back the post-resync
// device-truth value. Pinning the comparison target at beginEdit fixes
// that -- these tests lock the pin-at-beginEdit semantics from both sides.

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ValueField from './ValueField.svelte';

describe('ValueField pin-at-beginEdit', () => {
  it('commits the user typed value even when the live `value` prop changed mid-edit', async () => {
    const onChange = vi.fn();
    const { container, rerender } = render(ValueField, {
      value: 10, min: -100, max: 100, kind: 'dB-signed', onChange,
    });

    // Open the editor while value is still 10.
    const wrapper = container.querySelector('.vf')!;
    await fireEvent.click(wrapper);

    // Live prop changes underneath (simulated resync).
    await rerender({ value: 20, min: -100, max: 100, kind: 'dB-signed', onChange });

    // User types the new live value -- would be a silent no-op without pinning.
    const input = container.querySelector('input')!;
    await fireEvent.input(input, { target: { value: '20' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith(20);
  });

  it('treats commit-of-original-value as a no-op (pinned value semantics)', async () => {
    const onChange = vi.fn();
    const { container } = render(ValueField, {
      value: 10, min: -100, max: 100, kind: 'dB-signed', onChange,
    });
    const wrapper = container.querySelector('.vf')!;
    await fireEvent.click(wrapper);
    const input = container.querySelector('input')!;
    await fireEvent.input(input, { target: { value: '10' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });
});
