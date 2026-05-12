import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import SegmentedSelect from './SegmentedSelect.svelte';

const OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: 'SLOW' },
  { value: 1, label: 'MED' },
  { value: 2, label: 'FAST' },
];

describe('SegmentedSelect', () => {
  test('renders one button per option', () => {
    const onChange = vi.fn();
    render(SegmentedSelect, {
      props: { value: 0, options: OPTIONS, ariaLabel: 'Speed', onChange },
    });
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  test('marks the active option with aria-checked', () => {
    const onChange = vi.fn();
    render(SegmentedSelect, {
      props: { value: 1, options: OPTIONS, ariaLabel: 'Speed', onChange },
    });
    const med = screen.getByRole('radio', { name: 'MED' });
    expect(med.getAttribute('aria-checked')).toBe('true');
  });

  test('clicking an option fires onChange with its value', async () => {
    const onChange = vi.fn();
    render(SegmentedSelect, {
      props: { value: 0, options: OPTIONS, ariaLabel: 'Speed', onChange },
    });
    await fireEvent.click(screen.getByRole('radio', { name: 'FAST' }));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  test('arrow keys cycle through options', async () => {
    const onChange = vi.fn();
    const { container } = render(SegmentedSelect, {
      props: { value: 1, options: OPTIONS, ariaLabel: 'Speed', onChange },
    });
    const group = container.querySelector('[role="radiogroup"]')!;
    await fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith(2);
    await fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith(0);
  });

  test('disabled prevents interaction', async () => {
    const onChange = vi.fn();
    render(SegmentedSelect, {
      props: { value: 0, options: OPTIONS, ariaLabel: 'Speed', onChange, disabled: true },
    });
    await fireEvent.click(screen.getByRole('radio', { name: 'MED' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
