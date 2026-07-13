import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import BandTypeSelect, { TYPE_ORDER, FIRST_ORDER_TYPES, offeredTypes } from './BandTypeSelect.svelte';
import { FilterType } from '@/domain';

describe('offeredTypes', () => {
  it('offers only the base PEQ types when firstOrderEq is off', () => {
    expect(offeredTypes({ firstOrderEq: false })).toEqual(TYPE_ORDER);
  });

  it('appends the first-order types when firstOrderEq is on', () => {
    expect(offeredTypes({ firstOrderEq: true })).toEqual([...TYPE_ORDER, ...FIRST_ORDER_TYPES]);
  });

  it('never offers Linkwitz Transform, even with every feature on', () => {
    expect(offeredTypes({ firstOrderEq: true })).not.toContain(FilterType.LinkwitzTransform);
  });
});

describe('BandTypeSelect — Linkwitz Transform', () => {
  it('never renders a selectable Linkwitz option for a non-LT band', () => {
    const { container } = render(BandTypeSelect, { value: FilterType.Peaking, onChange: () => {} });
    expect(container.querySelector(`option[value="${FilterType.LinkwitzTransform}"]`)).toBeNull();
  });

  it('renders Linkwitz selected but disabled for a band already set to it', () => {
    const { container } = render(BandTypeSelect, { value: FilterType.LinkwitzTransform, onChange: () => {} });
    const select = container.querySelector('select')!;
    const ltOption = container.querySelector<HTMLOptionElement>(`option[value="${FilterType.LinkwitzTransform}"]`)!;
    expect(ltOption).not.toBeNull();
    expect(ltOption.disabled).toBe(true);
    expect(ltOption.textContent).toBe('Linkwitz');
    expect(select.value).toBe(String(FilterType.LinkwitzTransform));
  });
});
