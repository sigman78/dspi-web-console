import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import BandRow from './BandRow.svelte';
import { FilterType, type FilterParams } from '@/domain';

const ltBand = (over: Partial<FilterParams> = {}): FilterParams => ({
  type: FilterType.LinkwitzTransform,
  bypass: false,
  frequency: 60,
  q: 0.9,
  gain: 30, // fp, in Hz -- unused by this read-only row
  qp: 1.1,
  ...over,
});

const peakBand: FilterParams = {
  type: FilterType.Peaking, bypass: false, frequency: 1000, q: 1, gain: 3,
};

describe('BandRow — Linkwitz Transform is display-only', () => {
  it('does not offer Linkwitz Transform in the type dropdown for an ordinary band', () => {
    const { container } = render(BandRow, { index: 0, band: peakBand, onPatch: vi.fn() });
    expect(container.querySelector(`option[value="${FilterType.LinkwitzTransform}"]`)).toBeNull();
  });

  it('renders an existing LT band with "Linkwitz" selected and disabled in the dropdown', () => {
    const { container } = render(BandRow, { index: 0, band: ltBand(), onPatch: vi.fn() });
    const select = container.querySelector('select')!;
    const ltOption = container.querySelector<HTMLOptionElement>(`option[value="${FilterType.LinkwitzTransform}"]`)!;
    expect(select.value).toBe(String(FilterType.LinkwitzTransform));
    expect(ltOption.disabled).toBe(true);
    expect(ltOption.textContent).toBe('Linkwitz');
  });

  it('disables the FREQ and Q controls for an LT band, still showing f0/Q0', () => {
    const { container } = render(BandRow, { index: 0, band: ltBand({ frequency: 60, q: 0.9 }), onPatch: vi.fn() });
    const fields = container.querySelectorAll('.vf');
    expect(fields).toHaveLength(2); // FREQ, Q -- GAIN is the dash placeholder, not a .vf
    for (const f of fields) expect(f.classList.contains('disabled')).toBe(true);
    expect(fields[0].textContent).toContain('60');
    expect(fields[1].textContent).toContain('0.9');
  });

  it('shows a dash instead of a gain control for an LT band', () => {
    const { container } = render(BandRow, { index: 0, band: ltBand(), onPatch: vi.fn() });
    expect(container.querySelector('.gainDash')?.textContent).toBe('—');
  });

  it('an ordinary band keeps the normal enabled FREQ/Q/GAIN controls', () => {
    const { container } = render(BandRow, { index: 0, band: peakBand, onPatch: vi.fn() });
    const fields = container.querySelectorAll('.vf');
    expect(fields).toHaveLength(3);
    for (const f of fields) expect(f.classList.contains('disabled')).toBe(false);
    expect(container.querySelector('.gainDash')).toBeNull();
  });

  it('switching an LT band away to another type still calls onPatch with the new type', async () => {
    const onPatch = vi.fn();
    const { container } = render(BandRow, { index: 0, band: ltBand(), onPatch });
    const select = container.querySelector('select')!;
    await fireEvent.change(select, { target: { value: String(FilterType.Peaking) } });
    expect(onPatch).toHaveBeenCalledExactlyOnceWith({ type: FilterType.Peaking });
  });
});
