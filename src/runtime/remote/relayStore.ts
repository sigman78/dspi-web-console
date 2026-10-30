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

// The joined session this tab should come back to after a reload, with its own
// resume token. Kept per tab (sessionStorage survives a reload but is not
// shared), so another tab, a later browser start or a different attempt's token
// never takes a device over on its own.
const REJOIN_KEY = 'dspi-console-web/remote/rejoin';

export interface Rejoin {
  resume: string;
  name?: string;
}

export function readAutoRejoin(): Rejoin | null {
  try {
    const raw = sessionStorage.getItem(REJOIN_KEY);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return null;
    const { resume, name } = data as Record<string, unknown>;
    if (typeof resume !== 'string') return null;
    return { resume, name: typeof name === 'string' ? name : undefined };
  } catch {
    return null;
  }
}

export function writeAutoRejoin(next: Rejoin | null): void {
  try {
    if (next) sessionStorage.setItem(REJOIN_KEY, JSON.stringify(next));
    else sessionStorage.removeItem(REJOIN_KEY);
  } catch { /* storage unavailable: no automatic reconnect */ }
}

// Merges `patch` over the stored value; an undefined field is removed.
export function writeStore(patch: RemoteStore): void {
  try {
    const next = { ...readStore(), ...patch };
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* storage unavailable: the feature works without it */ }
}
