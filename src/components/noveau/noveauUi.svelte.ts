import type { ProgramModuleKey } from './program/programModel';
import type { SetupPageKey } from './setup/setupPages';

export type NoveauDestination = 'tune' | 'program' | 'setup' | 'library' | 'device';

export const noveauUi = $state<{
  destination: NoveauDestination;
  selectedBand: number | null;
  programModule: ProgramModuleKey;
  setupPage: SetupPageKey;
  healthOpen: boolean;
}>({
  destination: 'tune',
  selectedBand: null,
  programModule: 'crossfeed',
  setupPage: 'device',
  healthOpen: false,
});
