import type { DspDevice } from '@/device/DspDevice';
import type { PresetSlot } from '@/domain';
import type { ReadySession } from './appState.svelte';
import { StatusStore } from './telemetry.svelte';
import { createPresetsState } from './presets.svelte';
import { MirrorState } from './mirror.svelte';
import { LinkHealth } from './linkHealth.svelte';
import { WriteCoordinator } from '@/runtime/writes';

// Assembles a per-device session from its constituent stores. Kept apart from
// appState, which references these store classes type-only to avoid an import cycle.
export function makeReadySession(device: DspDevice, attempt = 0): ReadySession {
  const copySource = $state<{ slot: PresetSlot | null }>({ slot: null });
  const telemetry = new StatusStore();
  const presets = createPresetsState();
  const mirror = new MirrorState();
  const health = new LinkHealth();
  const writes = new WriteCoordinator(mirror);
  const session: ReadySession = {
    device, info: device.info, hardware: device.hardware, attempt,
    copySource, telemetry, presets, mirror, health, writes,
    alive: true,
    dispose() { session.alive = false; writes.cancel(); },
  };
  return session;
}
