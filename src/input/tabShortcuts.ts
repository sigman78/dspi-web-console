import { settings, setTab, TAB_ORDER, TAB_META } from '@/state';

// Rendered by the Overview quick-reference panel. Derived from the same
// TAB_ORDER the handler below dispatches on, so the help can't drift.
export const TAB_SHORTCUTS: ReadonlyArray<{ keys: readonly string[]; action: string }> = [
  ...TAB_ORDER.map((id, i) => ({ keys: [`Alt+${i + 1}`], action: TAB_META[id].label })),
  { keys: ['Alt+[', 'Alt+]'], action: 'PREV / NEXT TAB' },
];

const DIGIT_RE = /^Digit([1-9])$/;

export function handleTabShortcut(e: KeyboardEvent): boolean {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;

  const digitMatch = DIGIT_RE.exec(e.code);
  if (digitMatch) {
    const i = Number(digitMatch[1]) - 1;
    if (i < 0 || i >= TAB_ORDER.length) return false;
    setTab(TAB_ORDER[i]);
    return true;
  }

  if (e.code === 'BracketRight' || e.code === 'BracketLeft') {
    const cur = TAB_ORDER.indexOf(settings.tab);
    const dir = e.code === 'BracketRight' ? 1 : -1;
    const next = (cur + dir + TAB_ORDER.length) % TAB_ORDER.length;
    setTab(TAB_ORDER[next]);
    return true;
  }

  return false;
}
