// Stage helpers for the 11 heavy device-config actions (input source, I2S/
// S/PDIF pins, MCK/BCK, output type): each restarts the firmware audio
// pipeline, so panels stage a pending value here instead of writing it
// straight to the device. Same call signature as the underlying action;
// staging a value that already matches the live device value discards any
// pending entry for that key instead (the control snaps back to device
// truth). PendingChangesBar's APPLY runs the staged `apply` closures in
// `order` as one batch.

import * as Domain from '@/domain';
import { type ReadySession, type StagedEntry } from '@/state';
import {
  setInputSource, setInputRate, setSpdifRxPin, setSpdifRxPinExt, setSpdifInputEnabled,
  setI2sRxPin, setI2sInputChannels,
  setI2sBckPin, setMckEnabled, setMckPin, setMckMultiplier, setOutputType, setOutputDataPin,
} from './actions';

const ORDER = {
  outputPin: 10,
  bckPin: 12,
  mck: 14,
  spdifRxPin: 20,
  i2sRxPin: 20,
  spdifEnable: 21,   // after spdifRxPin: enable validates against the configured pin
  i2sChannels: 30,
  inputRate: 40,
  inputSource: 50,
} as const;

function fmtPin(pin: number): string { return `GP${pin}`; }
function fmtHz(hz: number): string { return hz > 0 ? `${(hz / 1000).toFixed(1)} kHz` : '—'; }
function fmtOnOff(v: boolean): string { return v ? 'on' : 'off'; }
function fmtMultiplier(encoded: number): string { return encoded === 1 ? '256×' : '128×'; }
function fmtSource(source: Domain.AudioInputSource): string {
  switch (source) {
    case Domain.AudioInputSource.Spdif: return 'S/PDIF';
    case Domain.AudioInputSource.I2s:   return 'I2S';
    default:                            return 'USB';
  }
}
function fmtOutputType(type: number): string { return type === Domain.OutputSlotType.I2s ? 'I2S' : 'SPDIF'; }

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
    // Firmware regenerates default input-channel names on a source switch,
    // but tags the resulting PARAM_CHANGED notifies Host-sourced -- the
    // notify channel drops those as an echo of this write. The optimistic
    // patch only touches inputConfig.source, so force a reconcile to pick
    // up the regenerated names from a fresh bulk read.
    apply: async () => {
      const ok = await setInputSource(s, source);
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
    label: 'I2S input rate',
    from: fmtHz(live),
    to: fmtHz(hz),
    value: hz,
    order: ORDER.inputRate,
    apply: () => setInputRate(s, hz),
    overlay: (snap) => ({ ...snap, inputConfig: { ...snap.inputConfig, i2sInputRateHz: hz } }),
  }));
}

export function stageSpdifRxPin(s: ReadySession, gpio: number): void {
  const live = s.mirror.snapshot.inputConfig.spdifRxPin;
  stageOrDiscard(s, 'spdifRxPin', live, gpio, () => ({
    key: 'spdifRxPin',
    label: 'S/PDIF RX pin',
    from: fmtPin(live),
    to: fmtPin(gpio),
    value: gpio,
    order: ORDER.spdifRxPin,
    apply: () => setSpdifRxPin(s, gpio),
    overlay: (snap) => ({ ...snap, inputConfig: { ...snap.inputConfig, spdifRxPin: gpio } }),
  }));
}

export function stageSpdifRxPinExt(s: ReadySession, extIndex: number, gpio: number): void {
  const key = `spdifRxPinExt:${extIndex}`;
  const live = s.mirror.snapshot.inputConfig.spdifRxPinExt[extIndex] ?? 0;
  stageOrDiscard(s, key, live, gpio, () => ({
    key,
    label: `S/PDIF ${extIndex + 2} RX pin`,
    from: fmtPin(live),
    to: fmtPin(gpio),
    value: gpio,
    order: ORDER.spdifRxPin,
    apply: () => setSpdifRxPinExt(s, extIndex, gpio),
    overlay: (snap) => {
      const pins = snap.inputConfig.spdifRxPinExt.slice();
      pins[extIndex] = gpio;
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
    order: ORDER.spdifEnable,
    apply: () => setSpdifInputEnabled(s, extIndex, on),
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
    to: fmtPin(gpio),
    value: gpio,
    order: ORDER.i2sRxPin,
    apply: () => setI2sRxPin(s, pair, gpio),
    overlay: (snap) => {
      const pins = snap.inputConfig.i2sRxPins.slice();
      pins[pair] = gpio;
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
    apply: () => setI2sInputChannels(s, count),
    overlay: (snap) => ({ ...snap, inputConfig: { ...snap.inputConfig, i2sInputChannels: count } }),
  }));
}

export function stageI2sBckPin(s: ReadySession, pin: number): void {
  const live = s.mirror.snapshot.i2s.bckPin;
  stageOrDiscard(s, 'bckPin', live, pin, () => ({
    key: 'bckPin',
    label: 'I2S BCK pin',
    from: fmtPin(live),
    to: fmtPin(pin),
    value: pin,
    order: ORDER.bckPin,
    apply: () => setI2sBckPin(s, pin),
    overlay: (snap) => ({ ...snap, i2s: { ...snap.i2s, bckPin: pin } }),
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
    order: ORDER.mck,
    apply: () => setMckEnabled(s, on),
    overlay: (snap) => ({ ...snap, i2s: { ...snap.i2s, mckEnabled: on } }),
  }));
}

export function stageMckPin(s: ReadySession, pin: number): void {
  const live = s.mirror.snapshot.i2s.mckPin;
  stageOrDiscard(s, 'mckPin', live, pin, () => ({
    key: 'mckPin',
    label: 'MCK pin',
    from: fmtPin(live),
    to: fmtPin(pin),
    value: pin,
    order: ORDER.mck,
    apply: () => setMckPin(s, pin),
    overlay: (snap) => ({ ...snap, i2s: { ...snap.i2s, mckPin: pin } }),
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
    apply: () => setMckMultiplier(s, encoded),
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
    apply: () => setOutputType(s, slot, type),
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
    to: fmtPin(pin),
    value: pin,
    order: ORDER.outputPin,
    apply: () => setOutputDataPin(s, pinOutputIndex, pin),
    overlay: (snap) => {
      const pins = snap.outputPins.slice();
      pins[pinOutputIndex] = pin;
      return { ...snap, outputPins: pins };
    },
  }));
}
