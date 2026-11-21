import { describe, it, expect } from 'vitest';
import { createRttMeter, PUBLISH_INTERVAL_MS } from './linkRtt';

function meter() {
  let t = 0;
  const published: number[] = [];
  const add = createRttMeter((ms) => { published.push(ms); }, () => t);
  return { add, published, advance: (ms: number) => { t += ms; } };
}

describe('createRttMeter', () => {
  it('publishes the first sample at once', () => {
    const m = meter();
    m.add(8);
    expect(m.published).toEqual([8]);
  });

  it('publishes at most once per interval, however fast samples arrive', () => {
    const m = meter();
    for (let i = 0; i < 50; i++) { m.add(5); m.advance(50); }
    expect(m.published.length).toBe(Math.ceil((50 * 50) / PUBLISH_INTERVAL_MS));
  });

  it('smooths: one outlier moves the published value only part of the way', () => {
    const m = meter();
    m.add(10);
    m.advance(PUBLISH_INTERVAL_MS);
    m.add(110);
    const [, second] = m.published;
    expect(second).toBeGreaterThan(10);
    expect(second).toBeLessThan(60);
  });
});
