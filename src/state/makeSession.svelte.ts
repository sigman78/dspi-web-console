import type { DspDevice } from '@/device/DspDevice';
import type { PresetClipboard, ReadySession } from './appState.svelte';
import { StatusStore } from './telemetry.svelte';
import { createPresetsState } from './presets.svelte';
import { MirrorState } from './mirror.svelte';
import { LinkHealth } from './linkHealth.svelte';
import { WriteCoordinator } from '@/runtime/writes.svelte';
import { NotifyWaiters } from '@/runtime/notifyWaiters';
import { CommandQueue } from '@/runtime/commandQueue';

// Assembles a per-device session from its constituent stores. Kept apart from
// appState, which references these store classes type-only to avoid an import cycle.
export function makeReadySession(device: DspDevice, attempt = 0): ReadySession {
  const copySource = $state<{ held: PresetClipboard | null }>({ held: null });
  const telemetry = new StatusStore();
  const presets = createPresetsState();
  const mirror = new MirrorState();
  const health = new LinkHealth();
  const writes = new WriteCoordinator(mirror);
  const notifyWaiters = new NotifyWaiters();
  const queue = new CommandQueue();
  const session: ReadySession = {
    device, info: device.info, hardware: device.hardware, attempt,
    copySource, telemetry, presets, mirror, health, writes, notifyWaiters, queue,
    alive: true,
    dispose() {
      session.alive = false;
      writes.cancel();
      queue.dispose();
      notifyWaiters.cancelAll();
    },
  };
  return session;
}
