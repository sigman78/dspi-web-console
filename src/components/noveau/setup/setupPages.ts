export type SetupPageKey = 'inputs' | 'outputs' | 'device' | 'interfaces';

export const SETUP_PAGE_KEYS: readonly SetupPageKey[] = ['inputs', 'outputs', 'device', 'interfaces'];

export interface SetupPage {
  key: SetupPageKey;
  label: string;
}

/** Pages with at least one available panel, in selector order. */
export function setupPages(features: { controlInterfaces: boolean }): SetupPage[] {
  const all: Array<SetupPage & { available: boolean }> = [
    { key: 'inputs', label: 'INPUTS', available: true },
    { key: 'outputs', label: 'OUTPUTS', available: true },
    { key: 'device', label: 'DEVICE', available: true },
    { key: 'interfaces', label: 'INTERFACES', available: features.controlInterfaces },
  ];
  return all.filter((p) => p.available).map(({ key, label }) => ({ key, label }));
}
