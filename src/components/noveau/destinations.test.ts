import { describe, test, expect } from 'vitest';
import { destinationShortcut, DESTINATIONS } from './destinations';

const full = DESTINATIONS.map((d) => d.key);
const alt = (code: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey', boolean>> = {}) =>
  ({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, code, ...mods });

describe('destinationShortcut', () => {
  test('Alt+digit picks by rail position', () => {
    expect(destinationShortcut(alt('Digit1'), full, 'tune')).toBe('room');
    expect(destinationShortcut(alt('Digit3'), full, 'tune')).toBe('program');
    expect(destinationShortcut(alt('Digit5'), full, 'tune')).toBe('control');
    expect(destinationShortcut(alt('Digit6'), full, 'tune')).toBe('about');
    expect(destinationShortcut(alt('Digit7'), full, 'tune')).toBeNull();
  });

  test('brackets cycle and wrap', () => {
    expect(destinationShortcut(alt('BracketRight'), full, 'about')).toBe('room');
    expect(destinationShortcut(alt('BracketLeft'), full, 'room')).toBe('about');
  });

  test('other modifiers and plain keys are left alone', () => {
    expect(destinationShortcut(alt('Digit1', { ctrlKey: true }), full, 'tune')).toBeNull();
    expect(destinationShortcut({ ...alt('Digit1'), altKey: false }, full, 'tune')).toBeNull();
    expect(destinationShortcut(alt('KeyA'), full, 'tune')).toBeNull();
  });
});
