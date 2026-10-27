// Stage verbs for hardware/IO configuration (input source, pins, clocks, ADAT,
// DAC mute, output enables, control interfaces, system clock): panels stage a
// pending value here instead of writing it straight to the device. Staging a
// value that already matches the live device value discards any pending entry
// for that key instead (the control snaps back to device truth). The
// StatusLine APPLY runs the staged `apply` closures in `order` as one batch.

import * as Domain from '@/domain';
import * as Clamp from '@/domain/clamp';
import { Wire } from '@/protocol';
import { type ReadySession, type StagedEntry, type Disruptive } from '@/state';
import { formatRateKHz } from '@/utils';
import * as Io from './ioActions';
import * as Mixer from './mixerActions';
import * as System from './systemActions';
import * as ControlSurface from './controlSurfaceActions';

const { PIN_RESET_TO_DEFAULT } = Wire.Const;

const ORDER = {
  outputPin: 10,
  bckPin: 12,
  clockPinMode: 13,   // before bckPinSlave: split mode must exist before its pin is set
  bckPinSlave: 14,
  mck: 16,
  spdifRxPin: 20,
  i2sRxPin: 20,
  spdifEnable: 21,   // after spdifRxPin: enable validates against the configured pin
  i2sChannels: 30,
  inputRate: 40,
  i2sClockMode: 45,   // after pin config, before the source switch below
  inputSource: 50,
  // Every disable or pin release sorts below every pin claim, so a pin freed
  // by one peripheral is free by the time another peripheral takes it.
  ifaceDisable: 3,
  dacMuteDisable: 4,
  adatInputDisable: 5,
  adatDisable: 6,
  spdifDisable: 7,
  mckDisable: 8,
  outputDisable: 9,   // a PDM pin is only reassignable while the output is off
  outputEnable: 11,
  adatPin: 22,        // before enable: the firmware refuses to enable on a taken pin
  adatEnable: 23,
  adatInputPin: 24,
  adatInputClock: 25,
  adatInputEnable: 26,
  dacMute: 60,
  controlIface: 70,
  sysClock: 90,       // last: the apply reboots the clock
} as const;

function fmtPin(pin: number): string { return `GP${pin}`; }
// 'to' can be the reset sentinel (fw resolves it device-side, index/pair/
// role-aware) -- render it literally instead of the meaningless "GP255".
// 'from' is always the live device pin, never the sentinel.
function fmtPinTo(pin: number): string { return pin === PIN_RESET_TO_DEFAULT ? 'default' : fmtPin(pin); }
// The sentinel isn't a real GPIO: writing it into the overlay would falsely
// free (or reserve) it in availablePinsFor's map. Keep the overlay at the
// live pin until the apply resolves the real default.
function overlayPin(current: number, next: number): number { return next === PIN_RESET_TO_DEFAULT ? current : next; }

// Pin-reset (0xFF) resolves on the device; force an eager reconcile so the
// resolved GPIO lands in the mirror right after this batch instead of
// waiting out the background poll's multi-second floor (see runtime/poll.ts).
async function applyPin(s: ReadySession, pin: number, send: () => Promise<boolean>): Promise<boolean> {
  const ok = await send();
  if (ok && pin === PIN_RESET_TO_DEFAULT) s.mirror.requestReconcile(true);
  return ok;
}
function fmtOnOff(v: boolean): string { return v ? 'on' : 'off'; }
function fmtMultiplier(encoded: number): string { return encoded === 1 ? '256×' : '128×'; }
function fmtSource(source: Domain.AudioInputSource): string {
  switch (source) {
    case Domain.AudioInputSource.Spdif:  return 'S/PDIF';
    case Domain.AudioInputSource.Spdif2: return 'S/PDIF 2';
    case Domain.AudioInputSource.Spdif3: return 'S/PDIF 3';
    case Domain.AudioInputSource.Spdif4: return 'S/PDIF 4';
    case Domain.AudioInputSource.I2s:    return 'I2S';
    case Domain.AudioInputSource.Adat:   return 'ADAT';
    default:                             return 'USB';
  }
}
function fmtOutputType(type: number): string { return type === Domain.OutputSlotType.I2s ? 'I2S' : 'SPDIF'; }
function fmtClockMode(mode: number): string { return mode === 1 ? 'slave' : 'master'; }
function fmtClockPinMode(mode: number): string { return mode === 1 ? 'split' : 'unified'; }

function stageOrDiscard(s: ReadySession, key: string, live: unknown, next: unknown, build: () => StagedEntry): void {
  if (live === next) { s.staging.discard(key); return; }
  s.staging.stage(build());
}

export function stageInputSource(s: ReadySession, source: Domain.AudioInputSource): void {
  const live = s.mirror.snapshot.inputConfig.source;
  stageOrDiscard(s, 'inputSource', live, source, () => ({
    key: 'inputSource',
    label: 'Input source',
    from: fmtSource(live),
    to: fmtSource(source),
    value: source,
    order: ORDER.inputSource,
    page: 'inputs',
    // Firmware regenerates default input-channel names on a source switch,
    // but tags the resulting PARAM_CHANGED notifies Host-sourced -- the
    // notify channel drops those as an echo of this write. The optimistic
    // patch only touches inputConfig.source, so force a reconcile to pick
    // up the regenerated names from a fresh bulk read.
    apply: async () => {
      const ok = await Io.setInputSource(s, source);
      if (ok) s.mirror.requestReconcile(true);
      return ok;
    },
    overlay: (snap) => ({ ...snap, inputConfig: { ...snap.inputConfig, source } }),
  }));
}

export function stageInputRate(s: ReadySession, hz: number): void {
  const live = s.mirror.snapshot.inputConfig.i2sInputRateHz;
  stageOrDiscard(s, 'inputRate', live, hz, () => ({
    key: 'inputRate',
    label: 'Input rate',
    from: formatRateKHz(live),
    to: formatRateKHz(hz),
    value: hz,
    order: ORDER.inputRate,
    page: 'inputs',
    apply: () => Io.setInputRate(s, hz),
    overlay: (snap) => ({ ...snap, inputConfig: { ...snap.inputConfig, i2sInputRateHz: hz } }),
  }));
}

export function stageSpdifRxPin(s: ReadySession, gpio: number): void {
  const live = s.mirror.snapshot.inputConfig.spdifRxPin;
  stageOrDiscard(s, 'spdifRxPin', live, gpio, () => ({
    key: 'spdifRxPin',
    label: 'S/PDIF RX pin',
    from: fmtPin(live),
    to: fmtPinTo(gpio),
    value: gpio,
    order: ORDER.spdifRxPin,
    page: 'inputs',
    apply: () => applyPin(s, gpio, () => Io.setSpdifRxPin(s, gpio)),
    overlay: (snap) => ({ ...snap, inputConfig: { ...snap.inputConfig, spdifRxPin: overlayPin(snap.inputConfig.spdifRxPin, gpio) } }),
  }));
}

export function stageSpdifRxPinExt(s: ReadySession, extIndex: number, gpio: number): void {
  const key = `spdifRxPinExt:${extIndex}`;
  const live = s.mirror.snapshot.inputConfig.spdifRxPinExt[extIndex] ?? 0;
  stageOrDiscard(s, key, live, gpio, () => ({
    key,
    label: `S/PDIF ${extIndex + 2} RX pin`,
    from: fmtPin(live),
    to: fmtPinTo(gpio),
    value: gpio,
    order: ORDER.spdifRxPin,
    page: 'inputs',
    apply: () => applyPin(s, gpio, () => Io.setSpdifRxPinExt(s, extIndex, gpio)),
    overlay: (snap) => {
      const pins = snap.inputConfig.spdifRxPinExt.slice();
      pins[extIndex] = overlayPin(pins[extIndex], gpio);
      return { ...snap, inputConfig: { ...snap.inputConfig, spdifRxPinExt: pins } };
    },
  }));
}

export function stageSpdifInputEnabled(s: ReadySession, extIndex: number, on: boolean): void {
  const key = `spdifEnable:${extIndex}`;
  const live = s.mirror.snapshot.inputConfig.spdifExtEnabled[extIndex] ?? false;
  stageOrDiscard(s, key, live, on, () => ({
    key,
    label: `S/PDIF ${extIndex + 2} input`,
    from: fmtOnOff(live),
    to: fmtOnOff(on),
    value: on,
    order: on ? ORDER.spdifEnable : ORDER.spdifDisable,
    page: 'inputs',
    apply: () => Io.setSpdifInputEnabled(s, extIndex, on),
    overlay: (snap) => {
      const enabled = snap.inputConfig.spdifExtEnabled.slice();
      enabled[extIndex] = on;
      return { ...snap, inputConfig: { ...snap.inputConfig, spdifExtEnabled: enabled } };
    },
  }));
}

export function stageI2sRxPin(s: ReadySession, pair: number, gpio: number): void {
  const key = `i2sRxPin:${pair}`;
  const live = s.mirror.snapshot.inputConfig.i2sRxPins[pair] ?? 0;
  stageOrDiscard(s, key, live, gpio, () => ({
    key,
    label: `I2S RX pair ${pair + 1} pin`,
    from: fmtPin(live),
    to: fmtPinTo(gpio),
    value: gpio,
    order: ORDER.i2sRxPin,
    page: 'inputs',
    apply: () => applyPin(s, gpio, () => Io.setI2sRxPin(s, pair, gpio)),
    overlay: (snap) => {
      const pins = snap.inputConfig.i2sRxPins.slice();
      pins[pair] = overlayPin(pins[pair], gpio);
      return { ...snap, inputConfig: { ...snap.inputConfig, i2sRxPins: pins } };
    },
  }));
}

const I2S_RX_PIN_KEY = /^i2sRxPin:(\d+)$/;

// Drop staged i2sRxPin:N entries for stereo pairs that no longer exist at
// `count` channels, so a shrunk channel count can't leave an orphaned pin
// staged (still shown in the bar, still affecting overlaySnapshot pin
// availability, still sent on APPLY where firmware may reject it).
function discardOrphanedI2sRxPins(s: ReadySession, count: number): void {
  const activePairs = Math.floor(count / 2);
  for (const entry of s.staging.entries.slice()) {
    const m = I2S_RX_PIN_KEY.exec(entry.key);
    if (m && Number(m[1]) >= activePairs) s.staging.discard(entry.key);
  }
}

export function stageI2sInputChannels(s: ReadySession, count: number): void {
  const live = s.mirror.snapshot.inputConfig.i2sInputChannels || 2;
  discardOrphanedI2sRxPins(s, count);
  stageOrDiscard(s, 'i2sChannels', live, count, () => ({
    key: 'i2sChannels',
    label: 'I2S input channels',
    from: `${live} ch`,
    to: `${count} ch`,
    value: count,
    order: ORDER.i2sChannels,
    page: 'inputs',
    apply: () => Io.setI2sInputChannels(s, count),
    overlay: (snap) => ({ ...snap, inputConfig: { ...snap.inputConfig, i2sInputChannels: count } }),
  }));
}

export function stageI2sBckPin(s: ReadySession, pin: number): void {
  const live = s.mirror.snapshot.i2s.bckPin;
  stageOrDiscard(s, 'bckPin', live, pin, () => ({
    key: 'bckPin',
    label: 'I2S BCK pin',
    from: fmtPin(live),
    to: fmtPinTo(pin),
    value: pin,
    order: ORDER.bckPin,
    page: 'outputs',
    apply: () => applyPin(s, pin, () => Io.setI2sBckPin(s, pin)),
    overlay: (snap) => ({ ...snap, i2s: { ...snap.i2s, bckPin: overlayPin(snap.i2s.bckPin, pin) } }),
  }));
}

export function stageI2sClockMode(s: ReadySession, mode: number): void {
  const live = s.mirror.snapshot.inputConfig.i2sClockMode;
  stageOrDiscard(s, 'i2sClockMode', live, mode, () => ({
    key: 'i2sClockMode',
    label: 'I2S clock mode',
    from: fmtClockMode(live),
    to: fmtClockMode(mode),
    value: mode,
    order: ORDER.i2sClockMode,
    page: 'outputs',
    apply: () => Io.setI2sClockMode(s, mode),
    overlay: (snap) => ({ ...snap, inputConfig: { ...snap.inputConfig, i2sClockMode: mode } }),
  }));
}

export function stageI2sClockPinMode(s: ReadySession, mode: number): void {
  const live = s.mirror.snapshot.i2s.clockPinMode;
  stageOrDiscard(s, 'i2sClockPinMode', live, mode, () => ({
    key: 'i2sClockPinMode',
    label: 'I2S BCK pin mode',
    from: fmtClockPinMode(live),
    to: fmtClockPinMode(mode),
    value: mode,
    order: ORDER.clockPinMode,
    page: 'outputs',
    apply: () => Io.setI2sClockPinMode(s, mode),
    overlay: (snap) => ({ ...snap, i2s: { ...snap.i2s, clockPinMode: mode } }),
  }));
}

export function stageI2sBckPinSlave(s: ReadySession, pin: number): void {
  const live = s.mirror.snapshot.i2s.bckPinSlave;
  stageOrDiscard(s, 'bckPinSlave', live, pin, () => ({
    key: 'bckPinSlave',
    label: 'I2S BCK pin (slave)',
    from: fmtPin(live),
    to: fmtPinTo(pin),
    value: pin,
    order: ORDER.bckPinSlave,
    page: 'outputs',
    apply: () => applyPin(s, pin, () => Io.setI2sBckPinSlave(s, pin)),
    overlay: (snap) => ({ ...snap, i2s: { ...snap.i2s, bckPinSlave: overlayPin(snap.i2s.bckPinSlave, pin) } }),
  }));
}

export function stageMckEnabled(s: ReadySession, on: boolean): void {
  const live = s.mirror.snapshot.i2s.mckEnabled;
  stageOrDiscard(s, 'mckEnabled', live, on, () => ({
    key: 'mckEnabled',
    label: 'MCK enable',
    from: fmtOnOff(live),
    to: fmtOnOff(on),
    value: on,
    order: on ? ORDER.mck : ORDER.mckDisable,
    page: 'outputs',
    apply: () => Io.setMckEnabled(s, on),
    overlay: (snap) => ({ ...snap, i2s: { ...snap.i2s, mckEnabled: on } }),
  }));
}

export function stageMckPin(s: ReadySession, pin: number): void {
  const live = s.mirror.snapshot.i2s.mckPin;
  stageOrDiscard(s, 'mckPin', live, pin, () => ({
    key: 'mckPin',
    label: 'MCK pin',
    from: fmtPin(live),
    to: fmtPinTo(pin),
    value: pin,
    order: ORDER.mck,
    page: 'outputs',
    apply: () => applyPin(s, pin, () => Io.setMckPin(s, pin)),
    overlay: (snap) => ({ ...snap, i2s: { ...snap.i2s, mckPin: overlayPin(snap.i2s.mckPin, pin) } }),
  }));
}

export function stageMckMultiplier(s: ReadySession, encoded: number): void {
  const live = s.mirror.snapshot.i2s.mckMultiplierEncoded;
  stageOrDiscard(s, 'mckMultiplier', live, encoded, () => ({
    key: 'mckMultiplier',
    label: 'MCK multiplier',
    from: fmtMultiplier(live),
    to: fmtMultiplier(encoded),
    value: encoded,
    order: ORDER.mck,
    page: 'outputs',
    apply: () => Io.setMckMultiplier(s, encoded),
    overlay: (snap) => ({ ...snap, i2s: { ...snap.i2s, mckMultiplierEncoded: encoded } }),
  }));
}

export function stageOutputType(s: ReadySession, slot: Domain.I2sPairSlot, type: number): void {
  const key = `outputType:${slot}`;
  const live = s.mirror.snapshot.i2s.outputSlotTypes[slot];
  stageOrDiscard(s, key, live, type, () => ({
    key,
    label: `Out ${slot + 1} type`,
    from: fmtOutputType(live),
    to: fmtOutputType(type),
    value: type,
    order: ORDER.outputPin,
    page: 'outputs',
    apply: () => Io.setOutputType(s, slot, type),
    overlay: (snap: Domain.DspSnapshot) => ({
      ...snap,
      i2s: {
        ...snap.i2s,
        outputSlotTypes: snap.i2s.outputSlotTypes.map((x, j) => (j === slot ? type : x)) as [number, number, number, number],
      },
    }),
  }));
}

export function stageOutputDataPin(s: ReadySession, pinOutputIndex: number, pin: number): void {
  const key = `outputPin:${pinOutputIndex}`;
  const live = s.mirror.snapshot.outputPins[pinOutputIndex];
  const isPdm = pinOutputIndex === s.mirror.snapshot.outputPins.length - 1;
  stageOrDiscard(s, key, live, pin, () => ({
    key,
    label: isPdm ? 'PDM sub pin' : `Out ${pinOutputIndex + 1} pin`,
    from: fmtPin(live),
    to: fmtPinTo(pin),
    value: pin,
    order: ORDER.outputPin,
    page: 'outputs',
    apply: () => applyPin(s, pin, () => Io.setOutputDataPin(s, pinOutputIndex, pin)),
    overlay: (snap) => {
      const pins = snap.outputPins.slice();
      pins[pinOutputIndex] = overlayPin(pins[pinOutputIndex], pin);
      return { ...snap, outputPins: pins };
    },
  }));
}

// --- Pin-collision context -------------------------------------------------

function stagedPatch(s: ReadySession, prefix: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const e of s.staging.entries) {
    if (e.key.startsWith(`${prefix}:`)) out[e.key.slice(prefix.length + 1)] = e.value;
  }
  return out;
}

// Live control-interface configs with their staged edits folded in; the
// snapshot overlay cannot carry them (they live outside the bulk packet).
export function stagedUart(s: ReadySession): Domain.UartControlConfig | null {
  const live = s.ctrlIfaces.uart;
  if (!live) return null;
  const p = stagedPatch(s, 'uart') as Partial<Domain.UartControlConfig>;
  const txPin = p.txPin ?? live.txPin;
  return { ...live, ...p, txPin, rxPin: txPin + 1 };
}

export function stagedI2c(s: ReadySession): Domain.I2cControlConfig | null {
  const live = s.ctrlIfaces.i2c;
  if (!live) return null;
  const p = stagedPatch(s, 'i2c') as Partial<Domain.I2cControlConfig>;
  const sdaPin = p.sdaPin ?? live.sdaPin;
  return { ...live, ...p, sdaPin, sclPin: sdaPin + 1 };
}

export function stagedCtrlPins(s: ReadySession) {
  return {
    uart: stagedUart(s),
    i2c: stagedI2c(s),
    cs: Domain.liveCsPinConfigs(s.controlSurfaces.bindings, s.controlSurfaces.status),
  };
}

function firstFreePin(snap: Domain.DspSnapshot, ctrl: ReturnType<typeof stagedCtrlPins>, wanted: number): number {
  const inUse = Domain.pinsInUse(snap, ctrl);
  const free = (p: number) => Domain.isAssignablePin(snap.platform.type, p, snap.platform.channelModel) && !inUse.has(p);
  if (free(wanted)) return wanted;
  return Domain.assignablePins(snap.platform.type, snap.platform.channelModel).find(free) ?? wanted;
}

function overlayOf(s: ReadySession): Domain.DspSnapshot {
  return s.staging.overlaySnapshot(s.mirror.snapshot);
}

// --- ADAT output -----------------------------------------------------------

const ADAT_DEFAULT_PIN = 12;   // platform default while the stored pin is 0

export function stageAdatPin(s: ReadySession, pin: number, autoFor?: string): void {
  const live = s.mirror.snapshot.adat.pin || ADAT_DEFAULT_PIN;
  stageOrDiscard(s, 'adatPin', live, pin, () => ({
    key: 'adatPin',
    label: 'ADAT pin',
    from: fmtPin(live),
    to: fmtPinTo(pin),
    value: pin,
    order: ORDER.adatPin,
    autoFor,
    page: 'outputs',
    apply: () => Io.setAdatPin(s, pin),
    overlay: (snap) => ({ ...snap, adat: { ...snap.adat, pin: overlayPin(snap.adat.pin, pin) } }),
  }));
}

export function stageAdatEnabled(s: ReadySession, on: boolean): void {
  if (on) {
    const eff = overlayOf(s);
    const want = eff.adat.pin || ADAT_DEFAULT_PIN;
    const ctrl = stagedCtrlPins(s);
    // A pin borrowed by the ADAT input is a loopback: leave it for the
    // device's PIN_IN_USE refusal to explain rather than silently breaking it.
    if (Domain.pinsInUse(eff, ctrl).get(want) !== 'ADAT IN') {
      const pin = firstFreePin(eff, ctrl, want);
      if (pin !== want) stageAdatPin(s, pin, 'adatEnable');
    }
  }
  const live = s.mirror.snapshot.adat.enabled;
  stageOrDiscard(s, 'adatEnable', live, on, () => ({
    key: 'adatEnable',
    label: 'ADAT output',
    from: fmtOnOff(live),
    to: fmtOnOff(on),
    value: on,
    order: on ? ORDER.adatEnable : ORDER.adatDisable,
    page: 'outputs',
    apply: () => Io.setAdatEnable(s, on),
    overlay: (snap) => ({ ...snap, adat: { ...snap.adat, enabled: on } }),
  }));
}

// --- ADAT input ------------------------------------------------------------

function fmtInputPin(pin: number): string { return pin === 0 || pin === PIN_RESET_TO_DEFAULT ? 'unset' : fmtPin(pin); }

export function stageAdatInputPin(s: ReadySession, pin: number): void {
  const live = s.mirror.snapshot.inputConfig.adatInputPin;
  const next = pin === PIN_RESET_TO_DEFAULT ? 0 : pin;
  stageOrDiscard(s, 'adatInputPin', live, next, () => ({
    key: 'adatInputPin',
    label: 'ADAT input pin',
    from: fmtInputPin(live),
    to: fmtInputPin(pin),
    value: next,
    order: ORDER.adatInputPin,
    page: 'inputs',
    apply: () => Io.setAdatInputPin(s, pin),
    overlay: (snap) => ({ ...snap, inputConfig: { ...snap.inputConfig, adatInputPin: next } }),
  }));
}

export function stageAdatInputEnabled(s: ReadySession, on: boolean): void {
  const live = s.mirror.snapshot.inputConfig.adatInputEnabled;
  stageOrDiscard(s, 'adatInputEnable', live, on, () => ({
    key: 'adatInputEnable',
    label: 'ADAT input',
    from: fmtOnOff(live),
    to: fmtOnOff(on),
    value: on,
    order: on ? ORDER.adatInputEnable : ORDER.adatInputDisable,
    page: 'inputs',
    apply: () => Io.setAdatInputEnable(s, on),
    overlay: (snap) => ({ ...snap, inputConfig: { ...snap.inputConfig, adatInputEnabled: on } }),
  }));
}

export function stageAdatInputClockMode(s: ReadySession, mode: number): void {
  const live = s.mirror.snapshot.inputConfig.adatInputClockMode;
  stageOrDiscard(s, 'adatInputClock', live, mode, () => ({
    key: 'adatInputClock',
    label: 'ADAT input clock',
    from: fmtClockMode(live),
    to: fmtClockMode(mode),
    value: mode,
    order: ORDER.adatInputClock,
    page: 'inputs',
    apply: () => Io.setAdatInputClockMode(s, mode),
    overlay: (snap) => ({ ...snap, inputConfig: { ...snap.inputConfig, adatInputClockMode: mode } }),
  }));
}

// Entries merged into one write take their band from the merged enable value:
// a disable releases its pin early, an enable (or plain edit of a live
// peripheral) claims late.
function reband(s: ReadySession, prefix: string, enabled: boolean, release: number, claim: number): void {
  const order = enabled ? claim : release;
  for (const e of s.staging.entries) {
    if (e.key.startsWith(`${prefix}:`)) e.order = order;
  }
}

// --- DAC hardware mute -----------------------------------------------------
// The wire takes the whole struct and the firmware drops a partial apply, so
// every staged field is sent as one merged write by whichever entry applies
// first; the rest see the live value already matching and are no-ops.

type DacMuteField = keyof Domain.DacHwMute;

const DAC_MUTE_LABEL: Record<DacMuteField, string> = {
  enabled: 'DAC mute',
  activeLow: 'DAC mute active low',
  pin: 'DAC mute pin',
  holdMs: 'DAC mute hold',
  releaseMs: 'DAC mute release',
};

function fmtDacMute(field: DacMuteField, v: number | boolean): string {
  if (field === 'pin') return fmtPin(v as number);
  if (field === 'holdMs' || field === 'releaseMs') return `${v} ms`;
  return fmtOnOff(v as boolean);
}

async function applyDacMute(s: ReadySession): Promise<boolean> {
  const patch = stagedPatch(s, 'dacMute') as Partial<Domain.DacHwMute>;
  const live = s.mirror.snapshot.dacHwMute;
  if ((Object.keys(patch) as DacMuteField[]).every((k) => live[k] === patch[k])) return true;
  return System.setDacHwMute(s, patch);
}

export function stageDacMute<K extends DacMuteField>(s: ReadySession, field: K, value: Domain.DacHwMute[K], autoFor?: string): void {
  const key = `dacMute:${field}`;
  const live = s.mirror.snapshot.dacHwMute[field];
  const next = field === 'holdMs' ? Clamp.dacHwMuteHoldMs(value as number)
    : field === 'releaseMs' ? Clamp.dacHwMuteReleaseMs(value as number)
      : value;
  stageOrDiscard(s, key, live, next, () => ({
    key,
    label: DAC_MUTE_LABEL[field],
    from: fmtDacMute(field, live),
    to: fmtDacMute(field, next as number | boolean),
    value: next,
    order: ORDER.dacMute,
    autoFor,
    page: 'outputs',
    apply: () => applyDacMute(s),
    overlay: (snap) => ({ ...snap, dacHwMute: { ...snap.dacHwMute, [field]: next } }),
  }));
  reband(s, 'dacMute', s.staging.valueOf('dacMute:enabled', s.mirror.snapshot.dacHwMute.enabled), ORDER.dacMuteDisable, ORDER.dacMute);
}

export function stageDacMuteEnabled(s: ReadySession, on: boolean): void {
  if (on) {
    const eff = overlayOf(s);
    const pin = firstFreePin(eff, stagedCtrlPins(s), eff.dacHwMute.pin);
    if (pin !== eff.dacHwMute.pin) stageDacMute(s, 'pin', pin, 'dacMute:enabled');
  }
  stageDacMute(s, 'enabled', on);
}

// --- Output enables --------------------------------------------------------

function pairWires(pair: number): number[] { return [pair * 2, pair * 2 + 1]; }

function overlayOutputsEnabled(snap: Domain.DspSnapshot, wires: number[], on: boolean): Domain.DspSnapshot {
  return { ...snap, outputs: snap.outputs.map((o) => (wires.includes(o.wireIndex) ? { ...o, enabled: on } : o)) };
}

export function stageOutputPairEnabled(s: ReadySession, pair: Domain.I2sPairSlot, on: boolean): void {
  const key = `pairEnable:${pair}`;
  const wires = pairWires(pair);
  const live = s.mirror.snapshot.outputs.some((o) => wires.includes(o.wireIndex) && o.enabled);
  stageOrDiscard(s, key, live, on, () => ({
    key,
    label: `Out ${pair + 1}`,
    from: fmtOnOff(live),
    to: fmtOnOff(on),
    value: on,
    order: on ? ORDER.outputEnable : ORDER.outputDisable,
    page: 'outputs',
    apply: () => Mixer.setOutputPairEnabled(s, pair, on),
    overlay: (snap) => overlayOutputsEnabled(snap, wires, on),
  }));
}

export function stagePdmEnabled(s: ReadySession, on: boolean): void {
  const slot = s.mirror.snapshot.platform.pdmOutputIndex as Domain.OutputSlot;
  const live = s.mirror.snapshot.outputs.find((o) => o.wireIndex === slot)?.enabled ?? false;
  stageOrDiscard(s, 'pdmEnable', live, on, () => ({
    key: 'pdmEnable',
    label: 'PDM sub',
    from: fmtOnOff(live),
    to: fmtOnOff(on),
    value: on,
    order: on ? ORDER.outputEnable : ORDER.outputDisable,
    page: 'outputs',
    apply: () => Mixer.setOutputEnabled(s, slot, on),
    overlay: (snap) => overlayOutputsEnabled(snap, [slot], on),
  }));
}

// --- Control interfaces ----------------------------------------------------
// Staged fields are merged into one config write (the firmware validates the
// enable against the pin shipped with it); the first entry to apply sends it.

type UartField = 'enabled' | 'txPin' | 'baud' | 'notifyEnabled';
type I2cField = 'enabled' | 'sdaPin' | 'address';

const UART_LABEL: Record<UartField, string> = {
  enabled: 'UART', txPin: 'UART TX pin', baud: 'UART baud', notifyEnabled: 'UART notify',
};
const I2C_LABEL: Record<I2cField, string> = {
  enabled: 'I2C', sdaPin: 'I2C SDA pin', address: 'I2C address',
};

function fmtCtrl(field: string, v: number | boolean): string {
  if (field === 'txPin' || field === 'sdaPin') return fmtPin(v as number);
  if (field === 'address') return `0x${(v as number).toString(16).padStart(2, '0').toUpperCase()}`;
  if (typeof v === 'boolean') return fmtOnOff(v);
  return String(v);
}

async function applyUart(s: ReadySession): Promise<boolean> {
  const next = stagedUart(s);
  const live = s.ctrlIfaces.uart;
  if (!next || !live) return true;
  if (JSON.stringify(next) === JSON.stringify(live)) return true;
  return ControlSurface.setUartControlConfig(s, next);
}

async function applyI2c(s: ReadySession): Promise<boolean> {
  const next = stagedI2c(s);
  const live = s.ctrlIfaces.i2c;
  if (!next || !live) return true;
  if (JSON.stringify(next) === JSON.stringify(live)) return true;
  return ControlSurface.setI2cControlConfig(s, next);
}

export function stageUart<K extends UartField>(s: ReadySession, field: K, value: Domain.UartControlConfig[K], autoFor?: string): void {
  const liveCfg = s.ctrlIfaces.uart;
  if (!liveCfg) return;
  const key = `uart:${field}`;
  const live = liveCfg[field];
  stageOrDiscard(s, key, live, value, () => ({
    key,
    label: UART_LABEL[field],
    from: fmtCtrl(field, live),
    to: fmtCtrl(field, value),
    value,
    order: ORDER.controlIface,
    autoFor,
    page: 'interfaces',
    apply: () => applyUart(s),
    overlay: (snap) => snap,
  }));
  reband(s, 'uart', s.staging.valueOf('uart:enabled', liveCfg.enabled), ORDER.ifaceDisable, ORDER.controlIface);
}

export function stageUartEnabled(s: ReadySession, on: boolean): void {
  const eff = stagedUart(s);
  if (on && eff) {
    const candidates = Domain.validUartTxPins(s.mirror.snapshot.platform.type, overlayOf(s), { ...stagedCtrlPins(s), uart: null });
    if (!candidates.includes(eff.txPin) && candidates[0] != null) stageUart(s, 'txPin', candidates[0], 'uart:enabled');
  }
  stageUart(s, 'enabled', on);
}

export function stageI2c<K extends I2cField>(s: ReadySession, field: K, value: Domain.I2cControlConfig[K], autoFor?: string): void {
  const liveCfg = s.ctrlIfaces.i2c;
  if (!liveCfg) return;
  const key = `i2c:${field}`;
  const live = liveCfg[field];
  stageOrDiscard(s, key, live, value, () => ({
    key,
    label: I2C_LABEL[field],
    from: fmtCtrl(field, live),
    to: fmtCtrl(field, value),
    value,
    order: ORDER.controlIface,
    autoFor,
    page: 'interfaces',
    apply: () => applyI2c(s),
    overlay: (snap) => snap,
  }));
  reband(s, 'i2c', s.staging.valueOf('i2c:enabled', liveCfg.enabled), ORDER.ifaceDisable, ORDER.controlIface);
}

export function stageI2cEnabled(s: ReadySession, on: boolean): void {
  const eff = stagedI2c(s);
  if (on && eff) {
    const ctrl = { ...stagedCtrlPins(s), i2c: null };
    const candidates = Domain.validI2cSdaPins(s.mirror.snapshot.platform.type, overlayOf(s), ctrl, Domain.csDisplayI2cInstance(ctrl.cs));
    if (!candidates.includes(eff.sdaPin) && candidates[0] != null) stageI2c(s, 'sdaPin', candidates[0], 'i2c:enabled');
  }
  stageI2c(s, 'enabled', on);
}

// --- System clock ----------------------------------------------------------

// Anything above the 307.2 MHz default is an overclock.
function sysClockDisruptive(mode: number): Disruptive {
  return { reason: 'reboots the clock', tone: mode > Domain.SysClockMode.Mhz307p2 ? 'danger' : 'warn' };
}

function fmtClockMhz(mode: number): string {
  const mhz = Domain.SYS_CLOCK_MODE_MHZ[mode];
  return `${Number.isInteger(mhz) ? mhz : mhz.toFixed(1)} MHz`;
}
function fmtVreg(sel: number): string {
  return sel === Domain.SYS_CLOCK_VREG_DEFAULT ? 'default' : `${Domain.sysClockVregVolts(sel).toFixed(2)} V`;
}

async function applyStagedSysClock(s: ReadySession): Promise<boolean> {
  const st = s.sysClock.status;
  if (!st) return false;
  const mode = s.staging.valueOf<Domain.SysClockMode>('sysClock:mode', st.storedMode);
  const vreg = s.staging.valueOf('sysClock:vreg', st.storedVregSel);
  if (mode === st.storedMode && vreg === st.storedVregSel) return true;
  return System.applySysClock(s, mode, vreg);
}

export function stageSysClockVreg(s: ReadySession, sel: number, autoFor?: string): void {
  const st = s.sysClock.status;
  if (!st) return;
  stageOrDiscard(s, 'sysClock:vreg', st.storedVregSel, sel, () => ({
    key: 'sysClock:vreg',
    label: 'Core voltage',
    from: fmtVreg(st.storedVregSel),
    to: fmtVreg(sel),
    value: sel,
    order: ORDER.sysClock,
    autoFor,
    page: 'device',
    disruptive: sysClockDisruptive(s.staging.valueOf('sysClock:mode', st.storedMode)),
    apply: () => applyStagedSysClock(s),
    overlay: (snap) => snap,
  }));
}

// A voltage below the new mode's default is invalid, so the firmware needs
// DEFAULT there; that reset is staged as its own visible entry.
export function stageSysClockMode(s: ReadySession, mode: Domain.SysClockMode): void {
  const st = s.sysClock.status;
  if (!st) return;
  const vreg = s.staging.valueOf('sysClock:vreg', st.storedVregSel);
  if (vreg !== Domain.SYS_CLOCK_VREG_DEFAULT && vreg < Domain.SYS_CLOCK_MODE_DEFAULT_VREG[mode]) {
    stageSysClockVreg(s, Domain.SYS_CLOCK_VREG_DEFAULT, 'sysClock:mode');
  }
  stageOrDiscard(s, 'sysClock:mode', st.storedMode, mode, () => ({
    key: 'sysClock:mode',
    label: 'System clock',
    from: fmtClockMhz(st.storedMode),
    to: fmtClockMhz(mode),
    value: mode,
    order: ORDER.sysClock,
    page: 'device',
    disruptive: sysClockDisruptive(mode),
    apply: () => applyStagedSysClock(s),
    overlay: (snap) => snap,
  }));
  const vregEntry = s.staging.get('sysClock:vreg');
  if (vregEntry) vregEntry.disruptive = sysClockDisruptive(s.staging.valueOf('sysClock:mode', st.storedMode));
}
