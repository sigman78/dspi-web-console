import { getContext } from 'svelte';
import type { ReadySession } from '@/state';

// Context key for the active device session, set by ConnectedApp at the
// connected boundary and read by connected-subtree components via getSession().
export const SESSION_KEY = Symbol('readySession');

// Non-null by construction: only call inside the subtree ConnectedApp renders,
// where the context is guaranteed set. This is the single Svelte-boundary spot
// where the session's presence is asserted rather than proven by the type system.
export function getSession(): ReadySession {
  return getContext<ReadySession>(SESSION_KEY);
}
