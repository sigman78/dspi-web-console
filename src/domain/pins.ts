// Client-side mirror of the firmware GPIO rules (vendor_commands.c
// is_valid_gpio_pin / is_pin_in_use); the firmware status byte stays the
// backstop. Feeds the pin dropdowns and BCK/MCK guard states.
// Generation-dependent: the debug UART sits on GPIO 12 through V10 and on
// GPIO 16/17 from V16; V16 also reserves the active I2S RX data pins.
import { OutputSlotType } from './channels';
import { PlatformType, type WireGen } from './platform';
import type { DspSnapshot } from './snapshot';

const PIN_LABEL = { bck: 'BCK', lrclk: 'LRCLK', mck: 'MCK' } as const;

function maxGpio(platform: PlatformType): number {
  return platform === PlatformType.RP2350 ? 29 : 28;
}

export function isAssignablePin(platform: PlatformType, pin: number, wireGen: WireGen = 10): boolean {
  if (pin < 0 || pin > maxGpio(platform)) return false;
  if (wireGen >= 16 ? (pin === 16 || pin === 17) : pin === 12) return false;   // debug UART
  if (pin >= 23 && pin <= 25) return false;
  return true;
}

export function assignablePins(platform: PlatformType, wireGen: WireGen = 10): number[] {
  const out: number[] = [];
  for (let p = 0; p <= maxGpio(platform); p++) if (isAssignablePin(platform, p, wireGen)) out.push(p);
  return out;
}

export function pinsInUse(snapshot: DspSnapshot): Map<number, string> {
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
  if (snapshot.dacHwMute.enabled) m.set(snapshot.dacHwMute.pin, 'DAC MUTE');
  // V16: the active I2S RX stereo pairs reserve their data pins (i2sInputChannels
  // is 0 on V10 packets, so this block is inert there).
  const cfg = snapshot.inputConfig;
  const activePairs = Math.floor((cfg.i2sInputChannels || 0) / 2);
  for (let p = 0; p < activePairs && p < cfg.i2sRxPins.length; p++) {
    if (cfg.i2sRxPins[p] > 0) m.set(cfg.i2sRxPins[p], `I2S RX ${p + 1}`);
  }
  return m;
}

export interface PinCandidate { pin: number; usedBy: string | null; }

export function availablePinsFor(
  platform: PlatformType, snapshot: DspSnapshot, selfPin: number,
): PinCandidate[] {
  const inUse = pinsInUse(snapshot);
  return assignablePins(platform, snapshot.platform.wireGen).map((pin) => ({
    pin,
    usedBy: pin === selfPin ? null : (inUse.get(pin) ?? null),
  }));
}

export function validBckPins(platform: PlatformType, snapshot: DspSnapshot): number[] {
  const wireGen = snapshot.platform.wireGen;
  const inUse = pinsInUse(snapshot);
  const free = (p: number) => {
    const u = inUse.get(p);
    return u == null || u === PIN_LABEL.bck || u === PIN_LABEL.lrclk;
  };
  return assignablePins(platform, wireGen).filter(
    (p) => isAssignablePin(platform, p + 1, wireGen) && free(p) && free(p + 1),
  );
}
