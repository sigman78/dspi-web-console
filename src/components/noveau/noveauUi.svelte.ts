import type { ProgramModuleKey } from '@/components/noveau/program/programModel';
import { SETUP_PAGES, type SetupPageKey } from '@/components/noveau/setup/setupPages';
import { CONTROL_PAGE_KEYS, type ControlPageKey } from '@/components/noveau/control/controlPages';

export type NoveauDestination = 'tune' | 'program' | 'setup' | 'control' | 'about';

export const noveauUi = $state<{
  destination: NoveauDestination;
  selectedBand: number | null;
  programModule: ProgramModuleKey;
  setupPage: SetupPageKey;
  controlPage: ControlPageKey;
  healthOpen: boolean;
  presetsOpen: boolean;
  pinMapOpen: boolean;
}>({
  destination: 'tune',
  selectedBand: null,
  programModule: 'crossfeed',
  setupPage: 'inputs',
  controlPage: 'interfaces',
  healthOpen: false,
  presetsOpen: false,
  pinMapOpen: false,
});

/** Destination holding the page that a staged entry belongs to, or null when the entry names no page. */
export function destinationOfPage(page: string | undefined): 'setup' | 'control' | null {
  if (page === undefined) return null;
  if (SETUP_PAGES.some((p) => p.key === page)) return 'setup';
  return CONTROL_PAGE_KEYS.some((k) => k === page) ? 'control' : null;
}

/** Switch to where a staged change lives. */
export function revealStaged(page: string | undefined): void {
  const dest = destinationOfPage(page);
  if (dest === null) return;
  noveauUi.destination = dest;
  if (dest === 'setup') noveauUi.setupPage = page as SetupPageKey;
  else noveauUi.controlPage = page as ControlPageKey;
}
