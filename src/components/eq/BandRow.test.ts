import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import BandRow from './BandRow.svelte';
import { TYPE_ORDER, LT_TYPES } from './BandTypeSelect.svelte';
import { FilterType, type FilterParams } from '@/domain';

const ltBand = (over: Partial<FilterParams> = {}): FilterParams => ({
  type: FilterType.LinkwitzTransform,
  bypass: false,
  frequency: 60,
  q: 0.9,
  gain: 30, // fp, in Hz
  qp: 1.1,
  ...over,
});

const peakBand: FilterParams = {
  type: FilterType.Peaking, bypass: false, frequency: 1000, q: 1, gain: 3,
};

const LT_CAPABLE_TYPES = [...TYPE_ORDER, ...LT_TYPES];

describe('BandRow — Linkwitz Transform gating', () => {
  it('does not offer Linkwitz Transform in the type dropdown when the device lacks the feature', () => {
    const { container } = render(BandRow, { index: 0, band: peakBand, onPatch: vi.fn(), types: TYPE_ORDER });
    expect(container.querySelector(`option[value="${FilterType.LinkwitzTransform}"]`)).toBeNull();
  });

  it('offers Linkwitz Transform in the type dropdown when the device has the feature', () => {
    const { container } = render(BandRow, { index: 0, band: peakBand, onPatch: vi.fn(), types: LT_CAPABLE_TYPES });
    expect(container.querySelector(`option[value="${FilterType.LinkwitzTransform}"]`)).not.toBeNull();
  });
});

describe('BandRow — Linkwitz Transform band controls', () => {
  it('shows four controls (F0, Q0, FP, QP) and no dB gain control', () => {
    const { container } = render(BandRow, { index: 0, band: ltBand(), onPatch: vi.fn(), types: LT_CAPABLE_TYPES });
    const fields = container.querySelectorAll('.vf');
    expect(fields).toHaveLength(4);
    // FP reuses the Hz formatting/unit of a frequency field, never dB.
    const units = Array.from(fields).map((f) => f.querySelector('.unit')?.textContent ?? '');
    expect(units).toEqual(['Hz', '', 'Hz', '']);
  });

  it('a non-LT band on an LT-capable device keeps the ordinary FREQ/Q/GAIN controls and no DC readout', () => {
    const { container } = render(BandRow, { index: 0, band: peakBand, onPatch: vi.fn(), types: LT_CAPABLE_TYPES });
    const fields = container.querySelectorAll('.vf');
    expect(fields).toHaveLength(3);
    expect(container.querySelector('.dcboost')).toBeNull();
  });

  it('edits to the FP field patch the gain slot (not a new field)', async () => {
    const onPatch = vi.fn();
    const { container } = render(BandRow, { index: 0, band: ltBand(), onPatch, types: LT_CAPABLE_TYPES });
    const fpField = container.querySelectorAll('.vf')[2];
    await fireEvent.click(fpField);
    const input = fpField.querySelector('input')!;
    await fireEvent.input(input, { target: { value: '45' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPatch).toHaveBeenCalledExactlyOnceWith({ gain: 45 });
  });

  it('edits to the QP field patch qp', async () => {
    const onPatch = vi.fn();
    const { container } = render(BandRow, { index: 0, band: ltBand(), onPatch, types: LT_CAPABLE_TYPES });
    const qpField = container.querySelectorAll('.vf')[3];
    await fireEvent.click(qpField);
    const input = qpField.querySelector('input')!;
    await fireEvent.input(input, { target: { value: '2' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPatch).toHaveBeenCalledExactlyOnceWith({ qp: 2 });
  });
});

describe('BandRow — DC-boost readout', () => {
  it('reports 40*log10(f0/fp) and flags it above +15 dB', () => {
    const { container } = render(BandRow, {
      index: 0, band: ltBand({ frequency: 200, gain: 20 }), onPatch: vi.fn(), types: LT_CAPABLE_TYPES,
    });
    const dc = container.querySelector('.dcboost')!;
    expect(dc.textContent).toBe('+40.0 dB');
    expect(dc.classList.contains('warn')).toBe(true);
  });

  it('stays unwarned for a small implied boost', () => {
    const { container } = render(BandRow, {
      index: 0, band: ltBand({ frequency: 110, gain: 100 }), onPatch: vi.fn(), types: LT_CAPABLE_TYPES,
    });
    const dc = container.querySelector('.dcboost')!;
    expect(dc.textContent).toBe('+1.7 dB');
    expect(dc.classList.contains('warn')).toBe(false);
  });

  it('reads 0 dB once fp reaches f0 (flat alignment)', () => {
    const { container } = render(BandRow, {
      index: 0, band: ltBand({ frequency: 60, gain: 60 }), onPatch: vi.fn(), types: LT_CAPABLE_TYPES,
    });
    expect(container.querySelector('.dcboost')!.textContent).toBe(' 0.0 dB');
  });
});
