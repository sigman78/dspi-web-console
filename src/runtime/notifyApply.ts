// Layer-2 orchestrator: turn a non-HOST PARAM_CHANGED into a precise local mirror
// update. Splices the raw buffer, diffs the buffer's own before/after decode
// (drift-safe), and applies only the changed fields into mirror.current in place
// (reactive). Returns false to mean "I didn't apply it — reconcile instead"; the
// full-reconcile backstop heals any declined/garbled event. Never throws.

import type { DspDevice } from '@/device/DspDevice';
import type { ParamChangedEvent } from '@/protocol';
import { diffSnapshots, applyChange } from '@/domain';
import { mirror, isInFlight, lastWriteMs } from '@/state/mirror.svelte';
import { spliceWireParam } from './wireMirror';
import { RECONCILE_QUIET_MS } from './poll';

export function applyParamChange(device: DspDevice, ev: ParamChangedEvent): boolean {
  const target = mirror.current;
  if (!target) return false;            // nothing to apply onto
  // Drop during a drag → backstop reconcile (global guard; per-field merge deferred).
  // Match the poll's gate: inflight is 0 in the ~16 ms gaps between coalesced scrub
  // sends, so the write-quiet window is what actually distinguishes mid-drag from done.
  if (isInFlight.current || performance.now() - lastWriteMs() < RECONCILE_QUIET_MS) return false;
  let r;
  try {
    r = spliceWireParam(device, ev.offset, ev.value);
  } catch {
    return false;                       // parse/decode threw → reconcile
  }
  if (r === null) return false;         // no buffer / out of range → reconcile
  for (const c of diffSnapshots(r.prev, r.next)) applyChange(c, target);
  return true;                          // applied locally; no USB re-read
}
