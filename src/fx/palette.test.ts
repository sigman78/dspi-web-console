import { describe, expect, test } from 'vitest';
import { css, oklchToRgb, rgbToOklch, type Rgb } from './palette';

const near = (a: readonly number[], b: readonly number[], tol: number) =>
  a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThanOrEqual(tol));

describe('rgbToOklch', () => {
  test('matches reference values', () => {
    const [l, c, h] = rgbToOklch([255, 0, 0]);
    near([l, c], [0.628, 0.2577], 0.005);
    near([h], [29.23], 0.5);
    const [wl, wc] = rgbToOklch([255, 255, 255]);
    near([wl, wc], [1, 0], 0.001);
  });
});

describe('oklchToRgb', () => {
  test('white and red map to their sRGB values', () => {
    near(oklchToRgb(1, 0, 0), [255, 255, 255], 0.01);
    near(oklchToRgb(0.628, 0.2577, 29.23), [255, 0, 0], 1.5);
  });

  test('round-trips in-gamut colours in both spaces', () => {
    const samples: Rgb[] = [[30, 120, 200], [200, 90, 60], [12, 200, 90], [128, 128, 128]];
    for (const space of ['srgb', 'display-p3'] as const) {
      for (const rgb of samples) {
        const [l, c, h] = rgbToOklch(rgb, space);
        near(oklchToRgb(l, c, h, space), rgb, 0.5);
      }
    }
  });

  test('out-of-gamut requests keep lightness and hue and lose chroma', () => {
    const rgb = oklchToRgb(0.7, 0.4, 145);
    for (const ch of rgb) {
      expect(ch).toBeGreaterThanOrEqual(0);
      expect(ch).toBeLessThanOrEqual(255);
    }
    const [l, c, h] = rgbToOklch(rgb);
    expect(c).toBeLessThan(0.4);
    expect(Math.abs(h - 145)).toBeLessThan(1);
    expect(Math.abs(l - 0.7)).toBeLessThan(0.01);
  });

  test('Display P3 holds chroma that sRGB must reduce', () => {
    const [, cSrgb] = rgbToOklch(oklchToRgb(0.7, 0.27, 145));
    const [, cP3] = rgbToOklch(oklchToRgb(0.7, 0.27, 145, 'display-p3'), 'display-p3');
    expect(cSrgb).toBeLessThan(0.25);
    expect(cP3).toBeGreaterThan(0.265);
  });

  test('sRGB red expressed in Display P3', () => {
    const [l, c, h] = rgbToOklch([255, 0, 0]);
    const p3 = oklchToRgb(l, c, h, 'display-p3').map((v) => v / 255);
    near(p3, [0.9175, 0.2003, 0.1386], 0.002);
  });
});

describe('css', () => {
  test('formats per colour space', () => {
    expect(css([255, 128, 0], 0.5, 'srgb')).toBe('rgba(255,128,0,0.5)');
    expect(css([255, 0, 0], 1, 'display-p3')).toBe('color(display-p3 1.0000 0.0000 0.0000 / 1)');
  });
});
