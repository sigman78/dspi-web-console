// Names stored on the device: one per input source plus the board's own.
// Support is probed once per connection (null until the probe lands); empty
// strings mean "unnamed" and callers fall back to their built-in label.

export interface NamesState {
  inputSourcesSupported: boolean | null;
  deviceSupported: boolean | null;
  inputSources: Record<number, string>;
  device: string;
}

export function createNamesState(): NamesState {
  const s = $state<NamesState>({
    inputSourcesSupported: null,
    deviceSupported: null,
    inputSources: {},
    device: '',
  });
  return s;
}
