import { describe, test, expect } from 'vitest';
import { destinationShortcut, destinations } from './destinations';

const full = destinations({ controlSurfaces: true }).map((d) => d.key);
const noCs = destinations({ controlSurfaces: false }).map((d) => d.key);
const alt = (code: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey', boolean>> = {}) =>
  ({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, code, ...mods });

describe('destinationShortcut', () => {
  test('Alt+digit picks by rail position, so CONTROL shifts the later keys', () => {
    expect(destinationShortcut(alt('Digit2'), full, 'tune')).toBe('program');
    expect(destinationShortcut(alt('Digit4'), full, 'tune')).toBe('control');
    expect(destinationShortcut(alt('Digit4'), noCs, 'tune')).toBe('about');
    expect(destinationShortcut(alt('Digit5'), noCs, 'tune')).toBeNull();
  });

  test('brackets cycle and wrap', () => {
    expect(destinationShortcut(alt('BracketRight'), full, 'about')).toBe('tune');
    expect(destinationShortcut(alt('BracketLeft'), full, 'tune')).toBe('about');
  });

  test('other modifiers and plain keys are left alone', () => {
    expect(destinationShortcut(alt('Digit1', { ctrlKey: true }), full, 'tune')).toBeNull();
    expect(destinationShortcut({ ...alt('Digit1'), altKey: false }, full, 'tune')).toBeNull();
    expect(destinationShortcut(alt('KeyA'), full, 'tune')).toBeNull();
  });
});
