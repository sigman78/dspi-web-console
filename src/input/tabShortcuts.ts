import { settings, setTab, TAB_ORDER } from '@/state';

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
