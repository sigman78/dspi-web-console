import { describe, expect, it } from 'vitest';
import { MeterWall, type MeterChannel } from './meterWall';

const ch = (key: number, over: Partial<MeterChannel> = {}): MeterChannel => ({
  key,
  label: 'L',
  groupLabel: null,
  group: 0,
  l: 0.7,
  c: 0.12,
  h: 200,
  ...over,
});

describe('MeterWall', () => {
  it('reports a change only when the pillars differ', () => {
    const w = new MeterWall();
    expect(w.setChannels([ch(1), ch(2, { group: 1 })])).toBe(true);
    expect(w.setChannels([ch(1), ch(2, { group: 1 })])).toBe(false);
    expect(w.setChannels([ch(1), ch(2, { group: 1, h: 210 })])).toBe(true);
  });

  it('keeps a pillar\'s level across a rename and starts a new one at zero', () => {
    const w = new MeterWall();
    w.setChannels([ch(1), ch(2, { group: 1 })]);
    const levels = new Float32Array(9);
    levels[1] = 0.5;
    for (let t = 0; t < 2000; t += 50) w.step(t, 50, levels, new Uint8Array(9));
    const before = w.energy();
    expect(before).toBeGreaterThan(0.5);

    w.setChannels([ch(1, { label: 'Woofer' }), ch(2, { group: 1 })]);
    expect(w.energy()).toBe(before);

    w.setChannels([ch(3)]);
    expect(w.energy()).toBe(0);
  });
});
