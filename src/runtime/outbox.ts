// Cross-lane coordinator. Owns the two operations that legitimately span both
// the per-item lane (commands.ts) and the bulk lane (commit.ts): flushPending
// (drain everything before a preset flash op, §10.2) and cancelAllCommands
// (teardown on disconnect/cancel). Importing both lane modules here keeps each
// lane module acyclic — neither imports the other.
import { dsp, session } from '@/state';
import { drainScrubLanes, cancelAllScrubLanes } from './commands';
import {
  convergeBulk, drainTrailingTimers, awaitBulkSettled, cancelBulkFlush,
} from './commit';

// Drain every pending write category so a following flash op (preset
// save/load/paste) sees settled device state. Order: trailing timers + converge,
// drain Tier-A scrub lanes, await Tier-B in-flight, then one converging flush if
// a new edit landed mid-drain. See docs/IDEAS.md §10.2.
export async function flushPending(): Promise<void> {
  drainTrailingTimers();
  await drainScrubLanes();
  await awaitBulkSettled();
  convergeBulk();
  await awaitBulkSettled();
}

// Teardown for disconnect/cancel. Cancels scrub lanes, bumps the generation so
// any in-flight send settles as a stale no-op, clears the optimistic-write
// token set, and resets the bulk-flush coordination.
export function cancelAllCommands(): void {
  cancelAllScrubLanes();
  session.generation += 1;
  dsp.pendingWrites.clear();
  cancelBulkFlush();
}
