import { SvelteMap } from 'svelte/reactivity';
import { activeRecord, recordOf } from './appState.svelte';
import type { ConnId } from './appState.svelte';
import { notifyShareActivity } from './hooks';

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
  // The relay stops honouring a code once it is used or has run out.
  status: 'live' | 'burnt' | 'expired';
}

export interface SharePeer {
  peerId: string;
  label: string;
  stage: 'pending' | 'connecting';
}

// A share paused because its device went away: the room stays open for the
// same device (by serial) until `until`.
export interface ShareAway {
  serial: string;
  until: number;
}

// Why a relay room is gone while the owner expected it open.
export type ShareEnd = 'relay-lost';

export type JoinFailure =
  | 'no-path' | 'bad-code' | 'burnt' | 'expired' | 'rate-limited' | 'no-host' | 'busy'
  | 'denied' | 'host-gone' | 'replaced' | 'violation' | 'unreachable' | 'timeout' | 'no-token' | 'sharing' | 'failed';

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
const _linkRtt = new SvelteMap<ConnId, number>();
let _share = $state<ShareState>('idle');
let _away = $state<ShareAway | null>(null);
let _room = $state<ShareRoom | null>(null);
let _peer = $state<SharePeer | null>(null);
let _shareEnd = $state<ShareEnd | null>(null);
let _shareNoPath = $state<string | null>(null);
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

// Smoothed round trip to the host console, in ms; null once the record is gone.
export function linkRttOf(id: ConnId): number | null {
  if (recordOf(id) === null) return null;
  return _linkRtt.get(id) ?? null;
}

export function activeLinkRtt(): number | null {
  const rec = activeRecord();
  return rec ? linkRttOf(rec.id) : null;
}

export function setLinkRtt(id: ConnId, ms: number): void {
  _linkRtt.set(id, ms);
}

export function clearLinkRtt(id: ConnId): void {
  _linkRtt.delete(id);
}

export function shareState(): ShareState {
  return _share;
}

export function setShareState(next: ShareState): void {
  if (_share === next) return;
  _share = next;
  notifyShareActivity();
}

export function shareAway(): ShareAway | null {
  return _away;
}

export function setShareAway(next: ShareAway | null): void {
  _away = next;
  notifyShareActivity();
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

// Label of the last console whose connection could not be established, until the next one arrives.
export function shareNoPath(): string | null {
  return _shareNoPath;
}

export function setShareNoPath(next: string | null): void {
  _shareNoPath = next;
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
  _linkRtt.clear();
  _share = 'idle';
  _away = null;
  _room = null;
  _peer = null;
  _shareEnd = null;
  _shareNoPath = null;
  _join = { phase: 'idle' };
  _pendingJoin = null;
}
