// Failures of background adoptions (boot stragglers, add-device attempts,
// reconnect replugs) that the appState reducer intentionally does not surface
// because another device stays active. Keyed by USB serial so a later
// successful adoption of the same physical device can retire its own badge.

import { SvelteMap } from 'svelte/reactivity';
import type { SessionErrorKind } from './appState.svelte';

export interface AdoptFailure {
  readonly serial: string;
  readonly message: string;
  readonly errorKind: SessionErrorKind;
}

const _failures = new SvelteMap<string, AdoptFailure>();

export function noteAdoptFailure(failure: AdoptFailure): void {
  _failures.set(failure.serial, failure);
}

export function adoptFailures(): ReadonlyMap<string, AdoptFailure> {
  return _failures;
}

export function clearAdoptFailure(serial: string): void {
  _failures.delete(serial);
}

export function clearAdoptFailures(): void {
  _failures.clear();
}
