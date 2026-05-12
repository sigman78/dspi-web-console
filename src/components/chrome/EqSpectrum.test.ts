import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import EqSpectrum from './EqSpectrum.svelte';

describe('EqSpectrum', () => {
  test('renders exactly 16 bars', () => {
    const { container } = render(EqSpectrum);
    expect(container.querySelectorAll('.bar')).toHaveLength(16);
  });

  test('root has the eq-spectrum class for layout hooks', () => {
    const { container } = render(EqSpectrum);
    expect(container.querySelector('.eq-spectrum')).not.toBeNull();
  });

  test('each bar has an animation-delay set via inline style or computed style', () => {
    const { container } = render(EqSpectrum);
    const bars = Array.from(container.querySelectorAll<HTMLElement>('.bar'));
    // Inline styles set per-bar offsets; assert at least one negative delay is present.
    const haveDelay = bars.filter((b) => b.style.animationDelay && b.style.animationDelay !== '0s');
    expect(haveDelay.length).toBe(16);
  });

  test('each bar has a per-bar height set inline (resting peak)', () => {
    const { container } = render(EqSpectrum);
    const bars = Array.from(container.querySelectorAll<HTMLElement>('.bar'));
    const haveHeight = bars.filter((b) => b.style.height && b.style.height.endsWith('%'));
    expect(haveHeight.length).toBe(16);
  });
});
