import type { ProgramModuleKey } from './program/programModel';

export type NoveauDestination = 'tune' | 'program' | 'setup' | 'library' | 'device';

export const noveauUi = $state<{
  destination: NoveauDestination;
  selectedBand: number | null;
  programModule: ProgramModuleKey;
  healthOpen: boolean;
}>({
  destination: 'tune',
  selectedBand: null,
  programModule: 'crossfeed',
  healthOpen: false,
});
