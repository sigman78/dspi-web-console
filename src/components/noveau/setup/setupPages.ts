export type SetupPageKey = 'inputs' | 'outputs' | 'device' | 'interfaces';

export interface SetupPage {
  key: SetupPageKey;
  label: string;
}

/** Pages in selector order. */
export const SETUP_PAGES: readonly SetupPage[] = [
  { key: 'inputs', label: 'INPUTS' },
  { key: 'outputs', label: 'OUTPUTS' },
  { key: 'device', label: 'DEVICE' },
  { key: 'interfaces', label: 'INTERFACES' },
];

export const SETUP_PAGE_KEYS: readonly SetupPageKey[] = SETUP_PAGES.map((p) => p.key);
