// Client-side mirror of the firmware GPIO rules (usb_audio.c
// is_valid_gpio_pin / is_pin_in_use); the firmware status byte stays the
// backstop. Feeds the pin dropdowns and BCK/MCK guard states.
import { OutputSlotType } from './channels';
import { PlatformType } from './platform';
import type { DspSnapshot } from './snapshot';

const PIN_LABEL = { bck: 'BCK', lrclk: 'LRCLK', mck: 'MCK' } as const;

function maxGpio(platform: PlatformType): number {
  return platform === PlatformType.RP2350 ? 29 : 28;
}

export function isAssignablePin(platform: PlatformType, pin: number): boolean {
  if (pin < 0 || pin > maxGpio(platform)) return false;
  if (pin === 12) return false;
  if (pin >= 23 && pin <= 25) return false;
  return true;
}

export function assignablePins(platform: PlatformType): number[] {
  const out: number[] = [];
  for (let p = 0; p <= maxGpio(platform); p++) if (isAssignablePin(platform, p)) out.push(p);
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
  return m;
}

export interface PinCandidate { pin: number; usedBy: string | null; }

export function availablePinsFor(
  platform: PlatformType, snapshot: DspSnapshot, selfPin: number,
): PinCandidate[] {
  const inUse = pinsInUse(snapshot);
  return assignablePins(platform).map((pin) => ({
    pin,
    usedBy: pin === selfPin ? null : (inUse.get(pin) ?? null),
  }));
}

export function validBckPins(platform: PlatformType, snapshot: DspSnapshot): number[] {
  const inUse = pinsInUse(snapshot);
  const free = (p: number) => {
    const u = inUse.get(p);
    return u == null || u === PIN_LABEL.bck || u === PIN_LABEL.lrclk;
  };
  return assignablePins(platform).filter(
    (p) => isAssignablePin(platform, p + 1) && free(p) && free(p + 1),
  );
}
