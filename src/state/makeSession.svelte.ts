import type { DspDevice } from '@/device/DspDevice';
import type { PresetClipboard, ReadySession } from './appState.svelte';
import { StatusStore } from './telemetry.svelte';
import { createPresetsState } from './presets.svelte';
import { createCtrlIfacesState } from './ctrlIfaces.svelte';
import { createControlSurfacesState } from './controlSurfaces.svelte';
import { createStagingState } from './staging.svelte';
import { MirrorState } from './mirror.svelte';
import { LinkHealth } from './linkHealth.svelte';
import { WriteCoordinator } from '@/runtime/writes.svelte';
import { NotifyWaiters } from '@/runtime/notifyWaiters';
import { CommandQueue } from '@/runtime/commandQueue';
import { ConnectionScope } from '@/runtime/connectionScope';

// Assembles a per-device session from its constituent stores. Kept apart from
// appState, which references these store classes type-only to avoid an import cycle.
//
// Takes the owning connection's scope (not its signal) so dispose() can abort
// it directly -- a session built for production always shares its
// connection's scope; a session built bare for a test gets a private one,
// and dispose() still works the same way either way.
export function makeReadySession(device: DspDevice, scope: ConnectionScope = new ConnectionScope()): ReadySession {
  const signal = scope.signal;
  const copySource = $state<{ held: PresetClipboard | null }>({ held: null });
  const telemetry = new StatusStore();
  const presets = createPresetsState();
  const ctrlIfaces = createCtrlIfacesState();
  const controlSurfaces = createControlSurfacesState();
  const staging = createStagingState();
  const mirror = new MirrorState();
  const health = new LinkHealth();
  const writes = new WriteCoordinator(mirror);
  const notifyWaiters = new NotifyWaiters();
  const queue = new CommandQueue();
  // Single teardown hook, registered once: abort is the only way alive flips
  // false, so this is the only place session resources get released.
  scope.onTeardown(() => {
    writes.cancel();
    queue.dispose();
    notifyWaiters.cancelAll();
  });
  const session: ReadySession = {
    device, info: device.info, hardware: device.hardware, signal,
    copySource, telemetry, presets, ctrlIfaces, controlSurfaces, staging, mirror, health, writes, notifyWaiters, queue,
    get alive() { return !scope.aborted; },
    dispose() { scope.abort(); },
  };
  return session;
}
