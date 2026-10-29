import { describe, expect, it } from 'vitest';
import { makeSnapshot } from '@test/fixtures/snapshotFixtures';
import * as Domain from '@/domain';

const { AudioInputSource, ChannelId } = Domain;

function snap(source: Domain.AudioInputSource, mutate?: (s: Domain.DspSnapshot) => void): Domain.DspSnapshot {
  const s = makeSnapshot();
  s.inputConfig = { ...s.inputConfig, source };
  for (const o of s.outputs) o.enabled = true;
  mutate?.(s);
  return s;
}

function disable(s: Domain.DspSnapshot, ...ids: Domain.ChannelId[]): void {
  for (const id of ids) s.outputs.find((o) => o.id === id)!.enabled = false;
}

const groups = (slots: { group: number }[]) => slots.map((s) => s.group);

describe('meterInputs', () => {
  it('pairs USB only when two channels are live', () => {
    const slots = Domain.meterInputs(snap(AudioInputSource.Usb), 2);
    expect(slots.map((s) => s.id)).toEqual([ChannelId.In1L, ChannelId.In1R]);
    expect(groups(slots)).toEqual([0, 0]);
  });

  it('shows two slots for an unknown live count but pairs them as the EQ link groups do', () => {
    // The fixture has eight hardware inputs, so unknown-live USB stays unpaired.
    const slots = Domain.meterInputs(snap(AudioInputSource.Usb), null);
    expect(slots).toHaveLength(2);
    expect(groups(slots)).toEqual([0, 1]);
  });

  it('keeps eight live USB channels as singles', () => {
    const slots = Domain.meterInputs(snap(AudioInputSource.Usb), 8);
    expect(slots).toHaveLength(8);
    expect(groups(slots)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('pairs eight live I2S channels into four groups', () => {
    const slots = Domain.meterInputs(snap(AudioInputSource.I2s), 8);
    expect(groups(slots)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });
});

describe('meterOutputs', () => {
  it('drops disabled outputs and keeps PDM as a trailing singleton', () => {
    const s = snap(AudioInputSource.Usb, (x) => disable(x, ChannelId.Out2L, ChannelId.Out2R));
    const slots = Domain.meterOutputs(s);
    expect(slots.map((x) => x.id)).toEqual([
      ChannelId.Out1L, ChannelId.Out1R, ChannelId.Out3L, ChannelId.Out3R,
      ChannelId.Out4L, ChannelId.Out4R, ChannelId.Pdm,
    ]);
    expect(groups(slots)).toEqual([0, 0, 1, 1, 2, 2, 3]);
  });

  it('never pairs the survivors of two half-disabled pairs', () => {
    const s = snap(AudioInputSource.Usb, (x) => disable(x, ChannelId.Out1R, ChannelId.Out2L));
    const slots = Domain.meterOutputs(s).filter((x) => x.id <= ChannelId.Out2R);
    expect(slots.map((x) => x.id)).toEqual([ChannelId.Out1L, ChannelId.Out2R]);
    expect(groups(slots)).toEqual([0, 1]);
    expect(slots.every((x) => x.groupLabel === null)).toBe(true);
  });

  it('carries pair labels onto both slots, and keeps full names when they do not match', () => {
    const s = snap(AudioInputSource.Usb, (x) => {
      x.channels.find((c) => c.id === ChannelId.Out1L)!.name = 'Woofer L';
      x.channels.find((c) => c.id === ChannelId.Out1R)!.name = 'Woofer R';
      x.channels.find((c) => c.id === ChannelId.Out2L)!.name = 'Tweeter';
      x.channels.find((c) => c.id === ChannelId.Out2R)!.name = 'Horn';
    });
    const slots = Domain.meterOutputs(s);
    expect(slots.slice(0, 2).map((x) => [x.label, x.groupLabel])).toEqual([['L', 'Woofer'], ['R', 'Woofer']]);
    expect(slots.slice(2, 4).map((x) => [x.label, x.groupLabel])).toEqual([['Tweeter', null], ['Horn', null]]);
  });
});

describe('sameMeterSlots', () => {
  it('detects a relabelled slot', () => {
    const a = Domain.meterOutputs(snap(AudioInputSource.Usb));
    const b = Domain.meterOutputs(snap(AudioInputSource.Usb));
    expect(Domain.sameMeterSlots(a, b)).toBe(true);
    b[0] = { ...b[0], label: 'X' };
    expect(Domain.sameMeterSlots(a, b)).toBe(false);
  });
});

describe('pairLabel', () => {
  it('extracts the shared prefix from default and renamed pairs', () => {
    expect(Domain.pairLabel('Out 1 Left', 'Out 1 Right')).toEqual({ group: 'Out 1', a: 'L', b: 'R' });
    expect(Domain.pairLabel('Woofer L', 'Woofer R')).toEqual({ group: 'Woofer', a: 'L', b: 'R' });
    expect(Domain.pairLabel('I2S 1 L', 'I2S 1 R')).toEqual({ group: 'I2S 1', a: 'L', b: 'R' });
  });

  it('rejects names that differ beyond the side token', () => {
    expect(Domain.pairLabel('Woofer L', 'Tweeter R')).toBeNull();
    expect(Domain.pairLabel('USB 1', 'USB 2')).toBeNull();
    expect(Domain.pairLabel('Sub L', 'Sub L')).toBeNull();
    expect(Domain.pairLabel('Wall', 'Wall')).toBeNull();
  });
});
