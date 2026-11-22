import { Codec } from '@/utils';
import * as Wire from '../wireTypes';
import type { ActionCommand, Command, RawCommand } from './types';

type SysClockStatusPayload = {
  activeMode: number; storedMode: number; storedVregSel: number;
  liveVreg: number; fallbackActive: boolean;
};

export const ClockCmd = {
  // --- I2S BCK/MCK pins (SETs are action-style, see ClockAct) ---
  // Role-indexed: GET wValue = role (0 = master/unified pair, 1 = slave pair).
  // See DspDevice.getI2sBckPin.
  I2sBckPin: { legacy: { get: 0xC3 } } satisfies RawCommand,
  MckEnable: { legacy: { get: 0xC5 } } satisfies RawCommand,
  MckPin: { legacy: { get: 0xC7 } } satisfies RawCommand,
  MckMultiplier: { legacy: { get: 0xC9 } } satisfies RawCommand,

  // --- I2S slave-clock mode ---
  // Clock role: payload u8, 0 = master, 1 = slave. Deferred apply -- firmware
  // applies from the main loop, so GET doesn't reflect a just-sent SET
  // immediately.
  I2sClockMode: { codec: Codec.u8, legacy: { get: 0x89, set: 0x88 } } satisfies Command<number>,
  // Live slave-clock lock status (no bulk equivalent).
  I2sSlaveStatus: { codec: Wire.I2sSlaveStatus, legacy: { get: 0x8A } },
  I2sClockPinMode: { legacy: { get: 0xFF } } satisfies RawCommand,

  // --- Selectable system clock (fw overclock branch; no wire/version gate yet). ---
  // SET is deferred apply (firmware applies from the main loop around the PLL
  // step), so a GET right after a SET may still report the old active mode.
  // Firmware validates before staging and STALLs on mode >= 3 or an
  // out-of-range vregSel; undervolting the target mode is rejected.
  SysClock: { codec: Wire.SysClockRequest, legacy: { set: 0x40 } } satisfies Command<{ mode: number; vregSel: number }>,
  SysClockStatus: { codec: Wire.SysClockStatus, legacy: { get: 0x41 } } satisfies Command<SysClockStatusPayload>,
} as const;

export const ClockAct = {
  // Role-indexed: SET wValue = (role<<8)|GPIO. See DspDevice.setI2sBckPin.
  I2sBckPin: { legacy: { code: 0xC2 } } satisfies ActionCommand,
  MckEnable: { legacy: { code: 0xC4 } } satisfies ActionCommand,
  MckPin: { legacy: { code: 0xC6 } } satisfies ActionCommand,
  MckMultiplier: { legacy: { code: 0xC8 } } satisfies ActionCommand,
  // BCK/LRCLK pin-sharing mode: wValue = 0 unified / 1 split, 1-byte
  // PinConfigResult (same convention as I2sBckPin).
  I2sClockPinMode: { legacy: { code: 0xFE } } satisfies ActionCommand,
} as const;
