import { dispatch, type ReadySession } from '@/state';
import { endConnection } from './connectionScope';
import { Log, timerClock, type LoopClock, type Disposer } from '@/utils';

const PROBE_INTERVAL_MS = 1000;
// ~5-10 s of degraded probing (2 s ctrl timeout each) before declaring the link dead.
const PROBE_FAILS_TO_KILL = 5;

// Recovery loop for a degraded link. Idle while healthy; once health flips
// degraded, issues the cheapest read (GetBypass: 1 byte, no feature gate, every
// supported firmware) each tick. One success verifies recovery and repaints
// truth; persistent failure tears the session down through the same path a USB
// unplug takes. Hidden tabs don't probe (and don't advance the kill counter).
export function startLinkProbe(s: ReadySession, clock: LoopClock = timerClock(PROBE_INTERVAL_MS)): Disposer {
  let stopped = false;
  let probing = false;
  let probeFails = 0;
  const isHidden = () => typeof document !== 'undefined' && document.hidden;

  async function tick(): Promise<void> {
    if (stopped || !s.alive) return;
    if (s.health.degraded && !probing && !isHidden()) {
      probing = true;
      try {
        await s.queue.run(() => s.device.getBypass(), { priority: true });
        s.health.noteRecovered();
        probeFails = 0;
        // Repaint via the param cadence's eager path (next tick), not an
        // ad-hoc fetch: one reconcile path for every recovery source.
        s.mirror.requestReconcile(true);
      } catch (err) {
        s.health.noteFail('probe', err);
        probeFails += 1;
        if (probeFails >= PROBE_FAILS_TO_KILL) {
          stopped = true;
          await killSession(s, err);
          return;
        }
      } finally {
        probing = false;
      }
    }
    if (!stopped) clock.next(tick);
  }

  clock.next(tick);
  return () => { stopped = true; clock.cancel(); };
}

// device.close() makes the transport emit 'disconnect', which runs the standard
// teardown (disconnected dispatch + endConnection) via the existing listener;
// endConnection()'s abort tears down the session too, so there is no separate
// dispose() call here. The trailing failed dispatch is deliberately
// unconditional -- unlike the guarded dispatches elsewhere, this is a forced
// transition that must land in 'errored' regardless of the (already-aborted)
// scope, so the user sees why the session ended.
async function killSession(s: ReadySession, err: unknown): Promise<void> {
  const msg = err instanceof Error ? err.message : String(err);
  Log.error('health', 'link dead; tearing down session', err);
  try { await s.device.close(); } catch { /* already gone */ }
  endConnection();
  dispatch({ t: 'failed', message: `Device stopped responding (${msg})` });
}
