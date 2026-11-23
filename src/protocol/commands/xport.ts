import * as Wire from '../wireTypes';
import type { Command } from './types';

export const XportCmd = {
  // --- External control interfaces (UART + I2C) ---
  // SETs are plain control-OUT with the struct payload; the firmware refuses
  // them over UART/I2C itself (USB-only), which is moot here since the
  // console always speaks USB. The result of a SET is read back from
  // CtrlIfaceStatus's matching last_status field; see DspDevice.
  UartConfig: { codec: Wire.UartCtrlConfig, legacy: { get: 0xF6, set: 0xF5 } } satisfies Command<{ enabled: boolean; txPin: number; rxPin: number; notifyEnable: boolean; baud: number }>,
  I2cConfig: { codec: Wire.I2cCtrlConfig, legacy: { get: 0xF8, set: 0xF7 } } satisfies Command<{ enabled: boolean; sdaPin: number; sclPin: number; address: number }>,
  CtrlIfaceStatus: { codec: Wire.CtrlIfaceStatus, legacy: { get: 0xF9 } } satisfies Command<{ uartLastStatus: number; uartLive: boolean; i2cLastStatus: number; i2cLive: boolean; protoVersion: number }>,
} as const;
