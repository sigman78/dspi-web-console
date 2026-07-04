// Turn a non-HOST PARAM_CHANGED into a precise local mirror update. Splices the
// raw buffer, diffs the buffer's own before/after decode (drift-safe), and applies
// only the changed fields into mirror.current in place. Returns false to mean "not
// applied -- reconcile instead"; the full-reconcile backstop heals any declined or
// garbled event. Never throws.

import type { ReadySession } from '@/state';
import type { ParamChangedEvent } from '@/protocol';
import { diffSnapshots, applyChange } from '@/domain';
import { spliceWireParam } from './wireMirror';

export function applyParamChange(s: ReadySession, ev: ParamChangedEvent): boolean {
  const mir = s.mirror;
  const target = mir.current;
  if (!target) return false;
  // Drop during a drag/write -> backstop reconcile (global guard; per-field
  // merge deferred). writes.busy is exact: every control-transfer send funnels
  // through the session's CommandQueue, so there is no quiet-window guess.
  if (s.writes.busy) return false;
  let r;
  try {
    r = spliceWireParam(s.device, ev.offset, ev.value);
  } catch {
    return false;                       // parse/decode threw -> reconcile
  }
  if (r === null) return false;         // no buffer / out of range -> reconcile
  for (const c of diffSnapshots(r.prev, r.next)) applyChange(c, target);
  return true;
}
