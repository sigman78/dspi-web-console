import type { ProgramModuleKey } from '@/components/noveau/program/programModel';
import { SETUP_PAGE_KEYS, type SetupPageKey } from '@/components/noveau/setup/setupPages';
import type { ControlPageKey } from '@/components/noveau/control/controlPages';

export type NoveauDestination = 'tune' | 'program' | 'setup' | 'control' | 'about';

export const noveauUi = $state<{
  destination: NoveauDestination;
  selectedBand: number | null;
  programModule: ProgramModuleKey;
  setupPage: SetupPageKey;
  controlPage: ControlPageKey;
  healthOpen: boolean;
  presetsOpen: boolean;
}>({
  destination: 'tune',
  selectedBand: null,
  programModule: 'crossfeed',
  setupPage: 'inputs',
  controlPage: 'surfaces',
  healthOpen: false,
  presetsOpen: false,
});

/** Staged entries only ever carry SETUP pages; null when the entry names none. */
export function destinationOfPage(page: string | undefined): 'setup' | null {
  return page !== undefined && SETUP_PAGE_KEYS.some((k) => k === page) ? 'setup' : null;
}

/** Switch to where a staged change lives. */
export function revealStaged(page: string | undefined): void {
  if (destinationOfPage(page) === null) return;
  noveauUi.destination = 'setup';
  noveauUi.setupPage = page as SetupPageKey;
}
