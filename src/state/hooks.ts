// Plain callback registries for runtime modules that react to state changes
// without being imported by the code that causes them.

import { Log } from '@/utils';
import type { DeviceRecord } from './appState.svelte';

function registry<A extends unknown[]>() {
  const fns = new Set<(...args: A) => void>();
  return {
    on(fn: (...args: A) => void): () => void {
      fns.add(fn);
      return () => { fns.delete(fn); };
    },
    emit(...args: A): void {
      for (const fn of [...fns]) {
        try { fn(...args); } catch (err) { Log.error('remote', 'hook failed', err); }
      }
    },
  };
}

const deviceReady = registry<[DeviceRecord]>();
const shareActivity = registry<[]>();

/** Called once a record has finished joining the registry (adoption done) or has just become the active one. */
export const onDeviceReady = deviceReady.on;
export const notifyDeviceReady = deviceReady.emit;

/** Called when the share state or the paused-share marker changes. */
export const onShareActivity = shareActivity.on;
export const notifyShareActivity = shareActivity.emit;
