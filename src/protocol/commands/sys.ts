import * as Wire from '../wireTypes';
import { PagedCmd } from '../paged.gen';
import type { ActionCommand, Command, RawCommand } from './types';

type DeviceInfoPayload = {
  platformId: number; fwMajor: number; fwMinorPatch: number;
};
type BuildInfoPayload = { describe: string; date: string };
type SysSystemStatusPayload = {
  clockHz: number; sampleRateHz: number; coreVoltageMv: number; tempCDegC: number; cpu0: number; cpu1: number;
};
type SysUsbAudioStatusPayload = {
  packets: number; ringOverruns: number; worstGapUs: number; altSetting: number; mounted: number;
};
type SysPipelineStatsPayload = {
  underrunEpisodes: number; blocksRefused: number; lowestFillFrames: number; inputGapWorstUs: number; backgroundOverBudget: number;
};
type SysPdmStatsPayload = { ringOverruns: number; ringUnderruns: number; dmaOverruns: number; dmaUnderruns: number };
type SysSpdifTxStatsPayload = { spdifUnderruns: number; starvationsTotal: number; slotStarvations: number[] };

export const SysCmd = {
  // Board name (see InputSourceName) and device info.
  DeviceName: { codec: Wire.ChannelName, legacy: { get: 0x57, set: 0x56 } } satisfies Command<string>,
  Serial: { codec: Wire.Serial, legacy: { get: 0x7E }, paged: { get: PagedCmd.SYS.SERIAL.id } } satisfies Command<string>,
  Platform: { codec: Wire.DeviceInfo, legacy: { get: 0x7F }, paged: { get: PagedCmd.SYS.PLATFORM.id } } satisfies Command<DeviceInfoPayload>,

  // Firmware git build stamp (fw 1.1.6+). Provenance for humans only.
  BuildInfo: { codec: Wire.BuildInfo, legacy: { get: 0x80 }, paged: { get: PagedCmd.SYS.BUILD_INFO.id } } satisfies Command<BuildInfoPayload>,
  BufferStats: { legacy: { get: 0xB0 } } satisfies RawCommand,

  // Status structs that replace the 1.1.6 GetStatus (0x50) scalar selectors;
  // each is read whole.
  SystemStatus: { codec: Wire.SysSystemStatus, legacy: {}, paged: { get: PagedCmd.SYS.SYSTEM_STATUS.id } } satisfies Command<SysSystemStatusPayload>,
  UsbAudioStatus: { codec: Wire.SysUsbAudioStatus, legacy: {}, paged: { get: PagedCmd.SYS.USB_AUDIO_STATUS.id } } satisfies Command<SysUsbAudioStatusPayload>,
  PipelineStats: { codec: Wire.SysPipelineStats, legacy: {}, paged: { get: PagedCmd.SYS.PIPELINE_STATS.id } } satisfies Command<SysPipelineStatsPayload>,
  PdmStats: { codec: Wire.SysPdmStats, legacy: {}, paged: { get: PagedCmd.SYS.PDM_STATS.id } } satisfies Command<SysPdmStatsPayload>,
  SpdifTxStats: { codec: Wire.SysSpdifTxStats, legacy: {}, paged: { get: PagedCmd.SYS.SPDIF_TX_STATS.id } } satisfies Command<SysSpdifTxStatsPayload>,
} as const;

export const SysAct = {
  ResetBufferStats: { legacy: { code: 0xB1 } } satisfies ActionCommand,

  // M8 — System command: reboot into UF2 bootloader (BOOTSEL).
  // Action-IN; firmware sends 1-byte success (0x01) then calls reset_usb_boot().
  // The device disconnects ~100 ms after the response, so the transfer may
  // throw. Callers must treat both a clean return and a throw as expected.
  EnterBootloader: { legacy: { code: 0xF0 } } satisfies ActionCommand,
} as const;
