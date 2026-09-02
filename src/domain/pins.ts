// Client-side mirror of the firmware GPIO rules (vendor_commands.c
// is_valid_gpio_pin / is_pin_in_use); the firmware status byte stays the
// backstop. Feeds the pin dropdowns and BCK/MCK guard states.
// Generation-dependent: the debug UART sits on GPIO 12 through V10; fw 1.1.5
// (V16) removed the debug UART, freeing GPIO 16/17 for general use there.
// V16 also reserves the active I2S RX data pins and (dynamically, since it's
// runtime config rather than a wire section) any enabled external
// control-interface pins -- see CtrlIfaceConfigs below.
import { OutputSlotType } from './channels';
import { PlatformType, ChannelFamily } from './platform';
import type { DspSnapshot } from './snapshot';
import { isValidUartPinPair, isValidI2cPinPair, type UartControlConfig, type I2cControlConfig } from './controlInterfaces';
import { CS_ADC_PINS } from './controlSurfaces';

const PIN_LABEL = { bck: 'BCK', lrclk: 'LRCLK', mck: 'MCK', bckSlave: 'BCK (slave)', lrclkSlave: 'LRCLK (slave)' } as const;

// Coarse category a reserved/assigned pin belongs to, for the PIN MAP panel's
// color coding (src/styles/palette-colors.ts holds the matching PinRoleKey
// palette; the two are asserted in lockstep in src/styles/palette.ts).
export type PinRole = 'audio-out' | 'audio-in' | 'clock' | 'control' | 'surface' | 'system';

export interface PinUse { label: string; role: PinRole; }

export function maxGpio(platform: PlatformType): number {
  return platform === PlatformType.RP2350 ? 47 : 28;
}

export function isAssignablePin(platform: PlatformType, pin: number, channelModel: ChannelFamily = ChannelFamily.Legacy): boolean {
  if (pin < 0 || pin > maxGpio(platform)) return false;
  if (channelModel === ChannelFamily.Legacy && pin === 12) return false;   // debug UART (V10 only)
  if (pin >= 23 && pin <= 25) return false;
  return true;
}

// Fetched control-interface configs, threaded through to the pin-picker
// helpers below so their GPIOs are excluded when enabled. Optional and
// defaults to none: callers that haven't fetched the ctrl-iface state yet
// (or are on a V10 device, where it's absent) get the pre-existing behavior.
export interface CtrlIfaceConfigs {
  uart?: UartControlConfig | null;
  i2c?: I2cControlConfig | null;
  // Live control-surface bindings, indexed by slot (null = slot empty or
  // down); their pins are reserved like any fixed peripheral's. A CS pin
  // picker passes the OTHER slots here so the edited slot's own pins stay
  // selectable.
  cs?: readonly ({ gpio0: number; gpio1: number | null } | null)[] | null;
}

const NO_CTRL_IFACES: CtrlIfaceConfigs = {};

export function assignablePins(platform: PlatformType, channelModel: ChannelFamily = ChannelFamily.Legacy): number[] {
  const out: number[] = [];
  for (let p = 0; p <= maxGpio(platform); p++) if (isAssignablePin(platform, p, channelModel)) out.push(p);
  return out;
}

export function pinUses(snapshot: DspSnapshot, ctrl: CtrlIfaceConfigs = NO_CTRL_IFACES): Map<number, PinUse> {
  const m = new Map<number, PinUse>();
  const lastIdx = snapshot.outputPins.length - 1;
  snapshot.outputPins.forEach((pin, idx) => {
    m.set(pin, { label: idx === lastIdx ? 'PDM' : `Slot ${idx + 1}`, role: 'audio-out' });
  });
  const i2s = snapshot.i2s;
  if (i2s) {
    if (i2s.outputSlotTypes.some((t) => t === OutputSlotType.I2s)) {
      m.set(i2s.bckPin, { label: PIN_LABEL.bck, role: 'clock' });
      m.set(i2s.bckPin + 1, { label: PIN_LABEL.lrclk, role: 'clock' });
    }
    if (i2s.mckEnabled) m.set(i2s.mckPin, { label: PIN_LABEL.mck, role: 'clock' });
    // fw V21+: the slave BCK/LRCLK pair is only reserved in split clock-pin
    // mode (unified mode shares the master pair above).
    if (i2s.clockPinMode === 1 && i2s.bckPinSlave > 0) {
      m.set(i2s.bckPinSlave, { label: PIN_LABEL.bckSlave, role: 'clock' });
      m.set(i2s.bckPinSlave + 1, { label: PIN_LABEL.lrclkSlave, role: 'clock' });
    }
  }
  m.set(snapshot.inputConfig.spdifRxPin, { label: 'SPDIF RX', role: 'audio-in' });
  // fw 1.1.5+ optional S/PDIF inputs 2/3: reserve a pin only while enabled
  // (matching firmware behavior -- a disabled optional input holds no GPIO).
  for (let i = 0; i < 2; i++) {
    if (snapshot.inputConfig.spdifExtEnabled[i] && snapshot.inputConfig.spdifRxPinExt[i] > 0) {
      m.set(snapshot.inputConfig.spdifRxPinExt[i], { label: `S/PDIF ${i + 2} RX`, role: 'audio-in' });
    }
  }
  if (snapshot.dacHwMute.enabled) m.set(snapshot.dacHwMute.pin, { label: 'DAC MUTE', role: 'system' });
  // ADAT lightpipe output (fw V17+, RP2350): pin 0 means platform default (GPIO 12).
  if (snapshot.adat.enabled) m.set(snapshot.adat.pin || 12, { label: 'ADAT', role: 'audio-out' });
  // ADAT lightpipe input (fw V24+, RP2350): reserved only while enabled, no
  // platform default (pin 0 = unset). Loopback onto the ADAT output's own pin
  // is a supported exception -- don't overwrite that claim's label.
  if (snapshot.inputConfig.adatInputEnabled && snapshot.inputConfig.adatInputPin !== 0 && !m.has(snapshot.inputConfig.adatInputPin)) {
    m.set(snapshot.inputConfig.adatInputPin, { label: 'ADAT IN', role: 'audio-in' });
  }
  // V16: the active I2S RX stereo pairs reserve their data pins (i2sInputChannels
  // is 0 on V10 packets, so this block is inert there).
  const cfg = snapshot.inputConfig;
  const activePairs = Math.floor((cfg.i2sInputChannels || 0) / 2);
  for (let p = 0; p < activePairs && p < cfg.i2sRxPins.length; p++) {
    if (cfg.i2sRxPins[p] > 0) m.set(cfg.i2sRxPins[p], { label: `I2S RX ${p + 1}`, role: 'audio-in' });
  }
  if (ctrl.uart?.enabled) {
    m.set(ctrl.uart.txPin, { label: 'UART TX', role: 'control' });
    m.set(ctrl.uart.rxPin, { label: 'UART RX', role: 'control' });
  }
  if (ctrl.i2c?.enabled) {
    m.set(ctrl.i2c.sdaPin, { label: 'I2C SDA', role: 'control' });
    m.set(ctrl.i2c.sclPin, { label: 'I2C SCL', role: 'control' });
  }
  ctrl.cs?.forEach((b, slot) => {
    if (!b) return;
    m.set(b.gpio0, { label: `CS slot ${slot + 1}`, role: 'surface' });
    if (b.gpio1 != null) m.set(b.gpio1, { label: `CS slot ${slot + 1}`, role: 'surface' });
  });
  return m;
}

// Label-only projection, kept for the validator helpers below (they compare
// labels against PIN_LABEL constants) and any other caller that only needs
// the "what's here" string.
export function pinsInUse(snapshot: DspSnapshot, ctrl: CtrlIfaceConfigs = NO_CTRL_IFACES): Map<number, string> {
  const m = new Map<number, string>();
  pinUses(snapshot, ctrl).forEach((use, pin) => m.set(pin, use.label));
  return m;
}

export interface PinCandidate { pin: number; usedBy: string | null; role: PinRole | null; adc: boolean; }

export function availablePinsFor(
  platform: PlatformType, snapshot: DspSnapshot, selfPin: number, ctrl: CtrlIfaceConfigs = NO_CTRL_IFACES,
): PinCandidate[] {
  const uses = pinUses(snapshot, ctrl);
  return assignablePins(platform, snapshot.platform.channelModel).map((pin) => {
    const use = pin === selfPin ? undefined : uses.get(pin);
    return { pin, usedBy: use?.label ?? null, role: use?.role ?? null, adc: CS_ADC_PINS.includes(pin) };
  });
}

export function validBckPins(
  platform: PlatformType, snapshot: DspSnapshot, ctrl: CtrlIfaceConfigs = NO_CTRL_IFACES,
): number[] {
  const channelModel = snapshot.platform.channelModel;
  const inUse = pinsInUse(snapshot, ctrl);
  const free = (p: number) => {
    const u = inUse.get(p);
    return u == null || u === PIN_LABEL.bck || u === PIN_LABEL.lrclk;
  };
  return assignablePins(platform, channelModel).filter(
    (p) => isAssignablePin(platform, p + 1, channelModel) && free(p) && free(p + 1),
  );
}

// Slave-mode BCK candidates (fw V21+, split clock-pin mode): same adjacency
// rule as validBckPins, but a pin currently holding the slave pair is free
// for re-selection (not the master pair -- that's still reserved).
export function validBckPinsSlave(
  platform: PlatformType, snapshot: DspSnapshot, ctrl: CtrlIfaceConfigs = NO_CTRL_IFACES,
): number[] {
  const channelModel = snapshot.platform.channelModel;
  const inUse = pinsInUse(snapshot, ctrl);
  const free = (p: number) => {
    const u = inUse.get(p);
    return u == null || u === PIN_LABEL.bckSlave || u === PIN_LABEL.lrclkSlave;
  };
  return assignablePins(platform, channelModel).filter(
    (p) => isAssignablePin(platform, p + 1, channelModel) && free(p) && free(p + 1),
  );
}

// UART TX candidates: RX always rides tx+1 (the wire format's fixed pattern),
// so -- like BCK/LRCLK above -- only the primary pin is picked; the panel
// shows RX as a derived hint. `ctrl` should omit `uart` (the interface being
// edited) so its own current pins don't count as taken; it still needs `i2c`
// so the other interface's pins are excluded.
export function validUartTxPins(
  platform: PlatformType, snapshot: DspSnapshot, ctrl: CtrlIfaceConfigs = NO_CTRL_IFACES,
): number[] {
  const channelModel = snapshot.platform.channelModel;
  const inUse = pinsInUse(snapshot, ctrl);
  const free = (p: number) => inUse.get(p) == null;
  return assignablePins(platform, channelModel).filter(
    (p) => p % 4 === 0
      && isAssignablePin(platform, p + 1, channelModel)
      && isValidUartPinPair(p, p + 1)
      && free(p) && free(p + 1),
  );
}

// I2C SDA candidates: SCL always rides sda+1 (same reasoning as above).
// `ctrl` should omit `i2c` and carry `uart`.
export function validI2cSdaPins(
  platform: PlatformType, snapshot: DspSnapshot, ctrl: CtrlIfaceConfigs = NO_CTRL_IFACES,
): number[] {
  const channelModel = snapshot.platform.channelModel;
  const inUse = pinsInUse(snapshot, ctrl);
  const free = (p: number) => inUse.get(p) == null;
  return assignablePins(platform, channelModel).filter(
    (p) => p % 2 === 0
      && isAssignablePin(platform, p + 1, channelModel)
      && isValidI2cPinPair(p, p + 1)
      && free(p) && free(p + 1),
  );
}

// Display-only decoration for the custom pin-picker grid (PinPicker v2): the
// full GPIO range with per-cell state, for rendering only. Selectability
// always derives from the existing validators -- never re-implemented here.
export interface PinPickerCell {
  pin: number;
  adc: boolean;
  use: PinUse | null;
  reserved: boolean;
  selectable: boolean;
  reason: string | null;
}

export function pickerCells(
  platform: PlatformType, snapshot: DspSnapshot, ctrl: CtrlIfaceConfigs = NO_CTRL_IFACES, selfPin?: number,
): PinPickerCell[] {
  const channelModel = snapshot.platform.channelModel;
  const uses = pinUses(snapshot, ctrl);
  const cells: PinPickerCell[] = [];
  for (let pin = 0; pin <= maxGpio(platform); pin++) {
    const adc = CS_ADC_PINS.includes(pin);
    if (!isAssignablePin(platform, pin, channelModel)) {
      cells.push({ pin, adc, use: null, reserved: true, selectable: false, reason: 'reserved' });
      continue;
    }
    if (pin === selfPin) {
      cells.push({ pin, adc, use: null, reserved: false, selectable: true, reason: null });
      continue;
    }
    const use = uses.get(pin) ?? null;
    cells.push({
      pin, adc, use, reserved: false,
      selectable: use == null, reason: use?.label ?? null,
    });
  }
  return cells;
}

export function pickerCellsFrom(
  platform: PlatformType, snapshot: DspSnapshot, ctrl: CtrlIfaceConfigs = NO_CTRL_IFACES,
  selectablePins: readonly number[], selfPin?: number, blockedReason?: (pin: number) => string,
): PinPickerCell[] {
  const channelModel = snapshot.platform.channelModel;
  const uses = pinUses(snapshot, ctrl);
  const selectableSet = new Set(selectablePins);
  const cells: PinPickerCell[] = [];
  for (let pin = 0; pin <= maxGpio(platform); pin++) {
    const adc = CS_ADC_PINS.includes(pin);
    if (!isAssignablePin(platform, pin, channelModel)) {
      cells.push({ pin, adc, use: null, reserved: true, selectable: false, reason: 'reserved' });
      continue;
    }
    const isSelf = pin === selfPin;
    if (selectableSet.has(pin) || isSelf) {
      const use = isSelf ? null : uses.get(pin) ?? null;
      cells.push({ pin, adc, use, reserved: false, selectable: true, reason: null });
      continue;
    }
    const use = uses.get(pin);
    if (use) {
      cells.push({ pin, adc, use, reserved: false, selectable: false, reason: use.label });
    } else {
      cells.push({ pin, adc, use: null, reserved: false, selectable: false, reason: blockedReason?.(pin) ?? 'unavailable' });
    }
  }
  return cells;
}
