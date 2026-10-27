// Irreversible-action confirmation, one-promise-at-a-time: a caller awaits
// askConfirm(); the host modal renders while pending != null. An ask while one
// is pending resolves false without disturbing it.
export interface ConfirmPrompt {
  title: string;
  body: string;
  confirmLabel: string;
  tone: 'danger' | 'warn';
}

export const confirmState = $state<{ pending: ConfirmPrompt | null }>({ pending: null });

let pendingResolve: ((ok: boolean) => void) | null = null;

export function askConfirm(prompt: ConfirmPrompt): Promise<boolean> {
  if (confirmState.pending !== null) return Promise.resolve(false);
  confirmState.pending = prompt;
  return new Promise<boolean>((resolve) => {
    pendingResolve = resolve;
  });
}

export function resolveConfirm(ok: boolean): void {
  const r = pendingResolve;
  pendingResolve = null;
  confirmState.pending = null;
  r?.(ok);
}
