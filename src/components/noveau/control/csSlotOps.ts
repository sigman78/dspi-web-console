// Slot plumbing the CS editors repeat: pick the next empty slot, run a device
// action under a busy flag, and finish an apply/remove by dropping the draft.
// Explicit-arg: each panel passes its own drafts view and busy setter.
import type { DraftFamilyView } from '@/state/drafts.svelte';

type Drafts = Pick<DraftFamilyView<unknown>, 'remove'>;

/** First slot below `max` that `taken` does not claim, else null. */
export function firstFreeSlot(max: number, taken: (slot: number) => boolean): number | null {
  for (let i = 0; i < max; i++) if (!taken(i)) return i;
  return null;
}

export async function whileBusy<T>(setBusy: (busy: boolean) => void, run: () => Promise<T>): Promise<T> {
  setBusy(true);
  try {
    return await run();
  } finally {
    setBusy(false);
  }
}

/** Send the draft; the device's acceptance replaces it as truth. */
export async function applySlot(
  slot: number, drafts: Drafts, setBusy: (busy: boolean) => void, send: () => Promise<boolean>,
): Promise<boolean> {
  const ok = await whileBusy(setBusy, send);
  if (ok) drafts.remove(slot);
  return ok;
}

/**
 * Remove a slot: a never-applied draft is just dropped; a live slot is
 * cleared on the device first. Resolves true when the draft is gone.
 */
export async function removeSlot(
  slot: number, isLive: boolean, drafts: Drafts, setBusy: (busy: boolean) => void, clear: () => Promise<boolean>,
): Promise<boolean> {
  if (!isLive) { drafts.remove(slot); return true; }
  return applySlot(slot, drafts, setBusy, clear);
}
