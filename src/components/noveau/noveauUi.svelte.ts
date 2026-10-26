import type { PresetSlot } from '@/domain';
import type { ProgramModuleKey } from './program/programModel';
import type { SetupPageKey } from './setup/setupPages';

export type NoveauDestination = 'tune' | 'program' | 'setup' | 'device';
export type LibraryPage = 'presets' | 'about';
export type LibraryAbout = 'changes' | 'quickref';

export const noveauUi = $state<{
  destination: NoveauDestination;
  selectedBand: number | null;
  programModule: ProgramModuleKey;
  setupPage: SetupPageKey;
  healthOpen: boolean;
  libraryOpen: boolean;
  libraryPage: LibraryPage;
  libraryAbout: LibraryAbout;
  // Slot shown in the LIBRARY detail column; null follows the active slot.
  librarySlot: PresetSlot | null;
}>({
  destination: 'tune',
  selectedBand: null,
  programModule: 'crossfeed',
  setupPage: 'device',
  healthOpen: false,
  libraryOpen: false,
  libraryPage: 'presets',
  libraryAbout: 'changes',
  librarySlot: null,
});
