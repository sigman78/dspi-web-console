import * as Wire from '../wireTypes';
import type { ActionCommand, Command, RawCommand } from './types';

type DeviceInfoPayload = {
  platformId: number; fwMajor: number; fwMinorPatch: number;
};
type BuildInfoPayload = { describe: string; date: string };

export const SysCmd = {
  // Board name (see InputSourceName) and device info.
  DeviceName: { codec: Wire.ChannelName, legacy: { get: 0x57, set: 0x56 } } satisfies Command<string>,
  Serial: { codec: Wire.Serial, legacy: { get: 0x7E } } satisfies Command<string>,
  Platform: { codec: Wire.DeviceInfo, legacy: { get: 0x7F } } satisfies Command<DeviceInfoPayload>,

  // Firmware git build stamp (fw 1.1.6+). Provenance for humans only.
  BuildInfo: { codec: Wire.BuildInfo, legacy: { get: 0x80 } } satisfies Command<BuildInfoPayload>,
  BufferStats: { legacy: { get: 0xB0 } } satisfies RawCommand,
} as const;

export const SysAct = {
  ResetBufferStats: { legacy: { code: 0xB1 } } satisfies ActionCommand,

  // M8 — System command: reboot into UF2 bootloader (BOOTSEL).
  // Action-IN; firmware sends 1-byte success (0x01) then calls reset_usb_boot().
  // The device disconnects ~100 ms after the response, so the transfer may
  // throw. Callers must treat both a clean return and a throw as expected.
  EnterBootloader: { legacy: { code: 0xF0 } } satisfies ActionCommand,
} as const;
