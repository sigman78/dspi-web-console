import { describe, it, expect } from 'vitest';
import { defaultFilter } from '@/domain';

describe('domain — filter defaults', () => {
  it('a default filter is not bypassed', () => {
    expect(defaultFilter().bypass).toBe(false);
  });
});
