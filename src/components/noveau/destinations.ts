import type { NoveauDestination } from './noveauUi.svelte';

export interface Destination { key: NoveauDestination; label: string }

// Rail order.
export const DESTINATIONS: readonly Destination[] = [
  { key: 'tune', label: 'TUNE' },
  { key: 'program', label: 'PROGRAM' },
  { key: 'setup', label: 'SETUP' },
  { key: 'control', label: 'CONTROL' },
  { key: 'about', label: 'ABOUT' },
];

export const DESTINATION_SHORTCUTS: ReadonlyArray<{ keys: readonly string[]; action: string }> = [
  { keys: ['Alt+1 … 5'], action: 'destination by rail position' },
  { keys: ['Alt+[', 'Alt+]'], action: 'previous / next destination' },
];

const DIGIT_RE = /^Digit([1-9])$/;

// Alt+digit picks by rail position, Alt+[ / Alt+] cycle. Returns the target,
// or null when the event is not a destination shortcut.
export function destinationShortcut(
  e: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'code'>,
  order: readonly NoveauDestination[],
  current: NoveauDestination,
): NoveauDestination | null {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  const digit = DIGIT_RE.exec(e.code);
  if (digit) {
    const i = Number(digit[1]) - 1;
    return i < order.length ? order[i] : null;
  }
  if (e.code === 'BracketRight' || e.code === 'BracketLeft') {
    const cur = Math.max(0, order.indexOf(current));
    const dir = e.code === 'BracketRight' ? 1 : -1;
    return order[(cur + dir + order.length) % order.length];
  }
  return null;
}
