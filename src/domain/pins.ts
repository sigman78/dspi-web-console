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

const PIN_LABEL = { bck: 'BCK', lrclk: 'LRCLK', mck: 'MCK' } as const;

function maxGpio(platform: PlatformType): number {
  return platform === PlatformType.RP2350 ? 29 : 28;
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

export function pinsInUse(snapshot: DspSnapshot, ctrl: CtrlIfaceConfigs = NO_CTRL_IFACES): Map<number, string> {
  const m = new Map<number, string>();
  const lastIdx = snapshot.outputPins.length - 1;
  snapshot.outputPins.forEach((pin, idx) => {
    m.set(pin, idx === lastIdx ? 'PDM' : `Slot ${idx + 1}`);
  });
  const i2s = snapshot.i2s;
  if (i2s) {
    if (i2s.outputSlotTypes.some((t) => t === OutputSlotType.I2s)) {
      m.set(i2s.bckPin, PIN_LABEL.bck);
      m.set(i2s.bckPin + 1, PIN_LABEL.lrclk);
    }
    if (i2s.mckEnabled) m.set(i2s.mckPin, PIN_LABEL.mck);
  }
  m.set(snapshot.inputConfig.spdifRxPin, 'SPDIF RX');
  // fw 1.1.5+ optional S/PDIF inputs 2/3: reserve a pin only while enabled
  // (matching firmware behavior -- a disabled optional input holds no GPIO).
  for (let i = 0; i < 2; i++) {
    if (snapshot.inputConfig.spdifExtEnabled[i] && snapshot.inputConfig.spdifRxPinExt[i] > 0) {
      m.set(snapshot.inputConfig.spdifRxPinExt[i], `S/PDIF ${i + 2} RX`);
    }
  }
  if (snapshot.dacHwMute.enabled) m.set(snapshot.dacHwMute.pin, 'DAC MUTE');
  // V16: the active I2S RX stereo pairs reserve their data pins (i2sInputChannels
  // is 0 on V10 packets, so this block is inert there).
  const cfg = snapshot.inputConfig;
  const activePairs = Math.floor((cfg.i2sInputChannels || 0) / 2);
  for (let p = 0; p < activePairs && p < cfg.i2sRxPins.length; p++) {
    if (cfg.i2sRxPins[p] > 0) m.set(cfg.i2sRxPins[p], `I2S RX ${p + 1}`);
  }
  if (ctrl.uart?.enabled) {
    m.set(ctrl.uart.txPin, 'UART TX');
    m.set(ctrl.uart.rxPin, 'UART RX');
  }
  if (ctrl.i2c?.enabled) {
    m.set(ctrl.i2c.sdaPin, 'I2C SDA');
    m.set(ctrl.i2c.sclPin, 'I2C SCL');
  }
  ctrl.cs?.forEach((b, slot) => {
    if (!b) return;
    m.set(b.gpio0, `CS slot ${slot + 1}`);
    if (b.gpio1 != null) m.set(b.gpio1, `CS slot ${slot + 1}`);
  });
  return m;
}

export interface PinCandidate { pin: number; usedBy: string | null; }

export function availablePinsFor(
  platform: PlatformType, snapshot: DspSnapshot, selfPin: number, ctrl: CtrlIfaceConfigs = NO_CTRL_IFACES,
): PinCandidate[] {
  const inUse = pinsInUse(snapshot, ctrl);
  return assignablePins(platform, snapshot.platform.channelModel).map((pin) => ({
    pin,
    usedBy: pin === selfPin ? null : (inUse.get(pin) ?? null),
  }));
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
