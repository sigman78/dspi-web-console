import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import BandTypeSelect from './BandTypeSelect.svelte';
import { FilterType } from '@/domain';

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
