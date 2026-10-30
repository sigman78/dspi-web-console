// Per-install remote-control data in localStorage. Storage can be missing or
// throw (private windows, blocked site data); every access degrades to "absent".

const KEY = 'dspi-console-web/remote/v1';

export interface RemoteStore {
  installId?: string;
  resume?: string;
  // The serial of the console the resume token leads to, for the Reconnect row.
  resumeName?: string;
}

export function readStore(): RemoteStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return {};
    const { installId, resume, resumeName } = data as Record<string, unknown>;
    return {
      installId: typeof installId === 'string' ? installId : undefined,
      resume: typeof resume === 'string' ? resume : undefined,
      resumeName: typeof resumeName === 'string' ? resumeName : undefined,
    };
  } catch {
    return {};
  }
}

// Merges `patch` over the stored value; an undefined field is removed.
export function writeStore(patch: RemoteStore): void {
  try {
    const next = { ...readStore(), ...patch };
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* storage unavailable: the feature works without it */ }
}
