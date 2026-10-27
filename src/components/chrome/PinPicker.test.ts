import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import type { PinPickerCell } from '@/domain';
import PinPicker from './PinPicker.svelte';

const CELLS: PinPickerCell[] = [
  { pin: 6, adc: false, use: null, reserved: false, selectable: true, reason: null },
  { pin: 7, adc: false, use: { label: 'Slot 2', role: 'audio-out' }, reserved: false, selectable: false, reason: 'Slot 2' },
  { pin: 12, adc: false, use: null, reserved: true, selectable: false, reason: 'reserved' },
  { pin: 16, adc: false, use: null, reserved: false, selectable: true, reason: null },
  { pin: 26, adc: true, use: null, reserved: false, selectable: true, reason: null },
];

describe('PinPicker', () => {
  test('renders one option per cell, covering the full passed-in range', () => {
    render(PinPicker, { props: { value: 6, cells: CELLS, ariaLabel: 'Slot 1 pin', onChange: vi.fn() } });
    expect(screen.getAllByRole('option', { hidden: true })).toHaveLength(CELLS.length);
  });

  test('clicking a free cell fires onChange with the numeric pin', async () => {
    const onChange = vi.fn();
    render(PinPicker, { props: { value: 6, cells: CELLS, ariaLabel: 'Slot 1 pin', onChange } });
    const opts = screen.getAllByRole('option', { hidden: true }) as HTMLButtonElement[];
    const free = opts.find((o) => o.textContent?.includes('GP16'))!;
    await fireEvent.click(free);
    expect(onChange).toHaveBeenCalledWith(16);
  });

  test('taken and reserved cells are disabled', () => {
    render(PinPicker, { props: { value: 6, cells: CELLS, ariaLabel: 'Slot 1 pin', onChange: vi.fn() } });
    const opts = screen.getAllByRole('option', { hidden: true }) as HTMLButtonElement[];
    expect(opts.find((o) => o.textContent?.includes('GP7'))!.disabled).toBe(true);
    expect(opts.find((o) => o.textContent?.includes('GP12'))!.disabled).toBe(true);
    expect(opts.find((o) => o.textContent?.includes('GP16'))!.disabled).toBe(false);
  });

  test('only the current value cell carries aria-selected', () => {
    render(PinPicker, { props: { value: 6, cells: CELLS, ariaLabel: 'Slot 1 pin', onChange: vi.fn() } });
    const opts = screen.getAllByRole('option', { hidden: true }) as HTMLButtonElement[];
    expect(opts.find((o) => o.textContent?.includes('GP6'))!.getAttribute('aria-selected')).toBe('true');
    expect(opts.find((o) => o.textContent?.includes('GP16'))!.getAttribute('aria-selected')).toBe('false');
  });

  test('trigger button shows the GP{n} label for the current value', () => {
    render(PinPicker, { props: { value: 16, cells: CELLS, ariaLabel: 'Slot 1 pin', onChange: vi.fn() } });
    expect(screen.getByRole('button', { name: 'Slot 1 pin' }).textContent).toBe('GP16');
  });

  test('placeholder replaces the label when value is 0', () => {
    render(PinPicker, { props: { value: 0, cells: CELLS, placeholder: 'UNSET', ariaLabel: 'Slot 1 pin', onChange: vi.fn() } });
    expect(screen.getByRole('button', { name: 'Slot 1 pin' }).textContent).toBe('UNSET');
  });

  test('value 0 with no placeholder still shows GP0', () => {
    render(PinPicker, { props: { value: 0, cells: CELLS, ariaLabel: 'Slot 1 pin', onChange: vi.fn() } });
    expect(screen.getByRole('button', { name: 'Slot 1 pin' }).textContent).toBe('GP0');
  });

  test('disabled prop disables the trigger button', () => {
    render(PinPicker, { props: { value: 6, cells: CELLS, disabled: true, ariaLabel: 'Slot 1 pin', onChange: vi.fn() } });
    expect((screen.getByRole('button', { name: 'Slot 1 pin' }) as HTMLButtonElement).disabled).toBe(true);
  });

  // A call site may pin the current value as unpickable (e.g. the GP0 UNSET
  // sentinel) -- being the selection must not re-enable it.
  test('the current value cell stays disabled when its cell is not selectable', () => {
    const cells: PinPickerCell[] = [
      { pin: 0, adc: false, use: null, reserved: false, selectable: false, reason: 'reserved as the UNSET sentinel' },
      ...CELLS,
    ];
    render(PinPicker, { props: { value: 0, cells, placeholder: 'UNSET', ariaLabel: 'Slot 1 pin', onChange: vi.fn() } });
    const gp0 = (screen.getAllByRole('option', { hidden: true }) as HTMLButtonElement[]).find((o) => o.textContent?.includes('GP0'))!;
    expect(gp0.disabled).toBe(true);
    expect(gp0.getAttribute('aria-selected')).toBe('true');
  });
});
