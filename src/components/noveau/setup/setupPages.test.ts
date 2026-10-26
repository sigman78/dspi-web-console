import { describe, test, expect } from 'vitest';
import type * as Domain from '@/domain';
import { setupPages } from './setupPages';

const keys = (f: { controlInterfaces: boolean; controlSurfaces: boolean }, caps: Domain.CsCaps | null) =>
  setupPages(f, caps).map((p) => p.key);

const displayCaps = { capsVersion: 10, types: new Array(32).fill(null) } as unknown as Domain.CsCaps;

describe('setupPages', () => {
  test('without control features only the always-on pages remain, in order', () => {
    expect(keys({ controlInterfaces: false, controlSurfaces: false }, null)).toEqual(['device', 'io', 'diagnostics']);
  });

  test('interfaces alone offers Interfaces but not Surfaces or Display', () => {
    expect(keys({ controlInterfaces: true, controlSurfaces: false }, null)).toEqual(['device', 'io', 'interfaces', 'diagnostics']);
  });

  test('control surfaces without display caps drops Display only', () => {
    expect(keys({ controlInterfaces: false, controlSurfaces: true }, null)).toEqual(['device', 'io', 'interfaces', 'surfaces', 'diagnostics']);
  });

  test('display capability adds Display between Surfaces and Diagnostics', () => {
    const k = keys({ controlInterfaces: true, controlSurfaces: true }, displayCaps);
    expect(k).toEqual(['device', 'io', 'interfaces', 'surfaces', 'display', 'diagnostics']);
  });
});
