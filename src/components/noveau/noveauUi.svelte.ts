export type NoveauDestination = 'tune' | 'program' | 'setup' | 'library' | 'device';

export const noveauUi = $state<{
  destination: NoveauDestination;
  selectedBand: number | null;
  healthOpen: boolean;
}>({
  destination: 'tune',
  selectedBand: null,
  healthOpen: false,
});
