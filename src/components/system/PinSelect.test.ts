import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import PinSelect from './PinSelect.svelte';

const CANDIDATES = [
  { pin: 6, usedBy: null },
  { pin: 7, usedBy: 'Slot 2' },
  { pin: 16, usedBy: null },
];

describe('PinSelect', () => {
  test('renders an option per candidate and disables in-use ones', () => {
    render(PinSelect, { props: { value: 6, candidates: CANDIDATES, ariaLabel: 'Slot 1 pin', onChange: vi.fn() } });
    const opts = screen.getAllByRole('option') as HTMLOptionElement[];
    expect(opts).toHaveLength(3);
    expect(opts.find((o) => o.value === '7')!.disabled).toBe(true);
    expect(opts.find((o) => o.value === '16')!.disabled).toBe(false);
  });

  test('selecting a pin fires onChange with the numeric pin', async () => {
    const onChange = vi.fn();
    render(PinSelect, { props: { value: 6, candidates: CANDIDATES, ariaLabel: 'Slot 1 pin', onChange } });
    await fireEvent.change(screen.getByRole('combobox'), { target: { value: '16' } });
    expect(onChange).toHaveBeenCalledWith(16);
  });

  test('omits the DEFAULT option when allowReset is unset', () => {
    render(PinSelect, { props: { value: 6, candidates: CANDIDATES, ariaLabel: 'Slot 1 pin', onChange: vi.fn() } });
    expect(screen.queryByRole('option', { name: 'DEFAULT' })).toBeNull();
  });

  test('allowReset renders a DEFAULT option ahead of the GPIO list', () => {
    render(PinSelect, { props: { value: 6, candidates: CANDIDATES, ariaLabel: 'Slot 1 pin', allowReset: true, onChange: vi.fn() } });
    const opts = screen.getAllByRole('option') as HTMLOptionElement[];
    expect(opts[0].textContent).toBe('DEFAULT');
    expect(opts[0].value).toBe('255');
    expect(opts).toHaveLength(CANDIDATES.length + 1);
  });

  test('selecting DEFAULT fires onChange with the 0xFF sentinel', async () => {
    const onChange = vi.fn();
    render(PinSelect, { props: { value: 6, candidates: CANDIDATES, ariaLabel: 'Slot 1 pin', allowReset: true, onChange } });
    await fireEvent.change(screen.getByRole('combobox'), { target: { value: '255' } });
    expect(onChange).toHaveBeenCalledWith(255);
  });
});
