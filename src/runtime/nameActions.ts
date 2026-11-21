// Writes for the names stored on the device. The device layer refuses a SET
// when the matching probe failed (the opcodes are legacy gain/mute on older
// firmware); these actions skip the send quietly in that case too.

import type { ReadySession } from '@/state';
import * as Domain from '@/domain';
import { command } from './writes.svelte';

// An empty name clears it. Resolves true once the device accepted the write.
// Only sources the device can select are named.
export async function setInputSourceName(s: ReadySession, source: number, name: string): Promise<boolean> {
  if (!s.device.inputSourceNamesSupported) return false;
  const caps = s.device.capabilities;
  const valid = Domain.selectableInputSources(caps.spdifInputCount, caps.features.adatInput);
  if (!valid.includes(source as Domain.AudioInputSource)) return false;
  let ok = false;
  await command(s, 'rename input source', () => s.device.setInputSourceName(source, name), (stored) => {
    s.names.inputSources[source] = stored;
    ok = true;
  });
  return ok;
}

export async function setDeviceName(s: ReadySession, name: string): Promise<boolean> {
  if (!s.device.deviceNameSupported) return false;
  let ok = false;
  await command(s, 'rename device', () => s.device.setDeviceName(name), (stored) => {
    s.names.device = stored;
    ok = true;
  });
  return ok;
}
