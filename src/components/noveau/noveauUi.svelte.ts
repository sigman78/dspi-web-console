import type { ProgramModuleKey } from '@/components/noveau/program/programModel';
import type { SetupPageKey } from '@/components/noveau/setup/setupPages';
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
  controlPage: 'interfaces',
  healthOpen: false,
  presetsOpen: false,
});
