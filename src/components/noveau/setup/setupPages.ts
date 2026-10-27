export type SetupPageKey = 'inputs' | 'outputs' | 'device';

export interface SetupPage {
  key: SetupPageKey;
  label: string;
}

export const SETUP_PAGES: SetupPage[] = [
  { key: 'inputs', label: 'INPUTS' },
  { key: 'outputs', label: 'OUTPUTS' },
  { key: 'device', label: 'DEVICE' },
];
