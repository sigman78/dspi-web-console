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

// Relay pairing on the owner side: the live room's code, and the console that
// is waiting on an Allow ('pending') or being handed the device ('connecting').
export interface ShareRoom {
  code: string;
  scanKey: string;
}

export interface SharePeer {
  peerId: string;
  label: string;
  stage: 'pending' | 'connecting';
}

// Why a relay room is gone while the owner expected it open.
export type ShareEnd = 'relay-lost';

export type JoinFailure =
  | 'bad-code' | 'burnt' | 'expired' | 'rate-limited' | 'no-host' | 'busy'
  | 'denied' | 'host-gone' | 'replaced' | 'violation' | 'unreachable' | 'timeout' | 'no-token' | 'failed';

// The joining console's progress through the relay handshake.
export type JoinState =
  | { phase: 'idle' | 'connecting' | 'waiting-allow' | 'allowed' | 'joined' }
  | { phase: 'failed'; reason: JoinFailure };

// A `?join=` link seen at boot, for the join popover to pick up.
export interface PendingJoin {
  code: string;
  scanKey: string | null;
}

const _leases = new SvelteMap<ConnId, Lease>();
let _share = $state<ShareState>('idle');
let _room = $state<ShareRoom | null>(null);
let _peer = $state<SharePeer | null>(null);
let _shareEnd = $state<ShareEnd | null>(null);
let _join = $state<JoinState>({ phase: 'idle' });
let _pendingJoin = $state<PendingJoin | null>(null);

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

export function shareRoom(): ShareRoom | null {
  return _room;
}

export function setShareRoom(next: ShareRoom | null): void {
  _room = next;
}

export function sharePeer(): SharePeer | null {
  return _peer;
}

export function setSharePeer(next: SharePeer | null): void {
  _peer = next;
}

export function shareEnd(): ShareEnd | null {
  return _shareEnd;
}

export function setShareEnd(next: ShareEnd | null): void {
  _shareEnd = next;
}

export function joinState(): JoinState {
  return _join;
}

export function setJoinState(next: JoinState): void {
  _join = next;
}

export function pendingJoin(): PendingJoin | null {
  return _pendingJoin;
}

export function setPendingJoin(next: PendingJoin | null): void {
  _pendingJoin = next;
}

// Test-only.
export function resetRemoteState(): void {
  _leases.clear();
  _share = 'idle';
  _room = null;
  _peer = null;
  _shareEnd = null;
  _join = { phase: 'idle' };
  _pendingJoin = null;
}
