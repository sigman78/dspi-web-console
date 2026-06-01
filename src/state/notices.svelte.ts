// Transient user-facing notices (toasts). The action boundary pushes one when a
// device rejects a command or an action throws unexpectedly; the Toaster renders
// them and they auto-expire. Distinct from session.status (connection state) —
// these are ephemeral, per-action messages, not a persistent mode.

export type NoticeKind = 'error' | 'warn' | 'info';
export interface Notice {
  readonly id: number;
  readonly kind: NoticeKind;
  readonly message: string;
}

const NOTICE_TTL_MS = 6000;

const _notices = $state<Notice[]>([]);
let _seq = 0;

export const notices = {
  get list(): readonly Notice[] { return _notices; },
};

export function pushNotice(kind: NoticeKind, message: string): number {
  const id = ++_seq;
  _notices.push({ id, kind, message });
  setTimeout(() => dismissNotice(id), NOTICE_TTL_MS);
  return id;
}

export function dismissNotice(id: number): void {
  const i = _notices.findIndex((n) => n.id === id);
  if (i !== -1) _notices.splice(i, 1);
}

export function clearNotices(): void {
  _notices.length = 0;
}
