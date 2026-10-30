import { SvelteMap } from 'svelte/reactivity';
import { activeRecord, recordOf } from './appState.svelte';
import type { ConnId } from './appState.svelte';

// Device-owner side of remote control. The lease lives beside the registry,
// not on DeviceRecord: records are plain objects in a SvelteMap, which tracks
// get/set/has but not property writes, so a field on the record would be
// invisible to $derived.
export interface Lease {
  peerLabel: string;
  since: number;
}

export type ShareState = 'idle' | 'sharing' | 'lent';

const _leases = new SvelteMap<ConnId, Lease>();
let _share = $state<ShareState>('idle');

// null once the record is gone, even if clearLease was never called.
export function leaseOf(id: ConnId): Lease | null {
  if (recordOf(id) === null) return null;
  return _leases.get(id) ?? null;
}

export function activeLease(): Lease | null {
  const rec = activeRecord();
  return rec ? leaseOf(rec.id) : null;
}

export function setLease(id: ConnId, lease: Lease): void {
  _leases.set(id, lease);
}

export function clearLease(id: ConnId): void {
  _leases.delete(id);
}

export function shareState(): ShareState {
  return _share;
}

export function setShareState(next: ShareState): void {
  _share = next;
}

// Test-only.
export function resetRemoteState(): void {
  _leases.clear();
  _share = 'idle';
}
