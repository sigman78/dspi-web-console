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

describe('ValueField floorLabel', () => {
  it('shows the floor label instead of the number at the floor', () => {
    const { container } = render(ValueField, {
      value: -30, min: -30, max: 6, kind: 'dB-signed', precision: 1, floorLabel: 'Off', onChange: vi.fn(),
    });
    expect(container.querySelector('.num')!.textContent).toBe('Off');
  });

  it('shows the formatted number above the floor', () => {
    const { container } = render(ValueField, {
      value: 6, min: -30, max: 6, kind: 'dB-signed', precision: 1, floorLabel: 'Off', onChange: vi.fn(),
    });
    expect(container.querySelector('.num')!.textContent).toBe('+6.0');
  });
});

describe('ValueField ceilLabel', () => {
  it('shows the ceiling label instead of the number at the max', () => {
    const { container } = render(ValueField, {
      value: 0, min: -40, max: 0, kind: 'dB-signed', precision: 1, ceilLabel: 'Off', onChange: vi.fn(),
    });
    expect(container.querySelector('.num')!.textContent).toBe('Off');
  });

  it('shows the formatted number below the max', () => {
    const { container } = render(ValueField, {
      value: -12, min: -40, max: 0, kind: 'dB-signed', precision: 1, ceilLabel: 'Off', onChange: vi.fn(),
    });
    expect(container.querySelector('.num')!.textContent).toBe('−12.0');
  });
});

describe('ValueField keyboard stepping', () => {
  const props = { value: 10, min: 0, max: 12, step: 0.5, kind: 'dB-signed' as const };

  it('ArrowUp/ArrowDown step by one step and Shift by ten, clamped to range', async () => {
    const onChange = vi.fn();
    const { container } = render(ValueField, { ...props, onChange });
    const field = container.querySelector('.vf')!;
    await fireEvent.keyDown(field, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith(10.5);
    await fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith(9.5);
    await fireEvent.keyDown(field, { key: 'ArrowUp', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(12);
  });

  it('does not step at the limit or while disabled', async () => {
    const onChange = vi.fn();
    const { container } = render(ValueField, { ...props, value: 12, onChange });
    await fireEvent.keyDown(container.querySelector('.vf')!, { key: 'ArrowUp' });
    expect(onChange).not.toHaveBeenCalled();
    const off = render(ValueField, { ...props, disabled: true, onChange });
    await fireEvent.keyDown(off.container.querySelector('.vf')!, { key: 'ArrowDown' });
    expect(onChange).not.toHaveBeenCalled();
  });
});
