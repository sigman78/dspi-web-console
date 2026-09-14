import * as Domain from '@/domain';
import { type ReadySession, pushNotice } from '@/state';
import { Wire } from '@/protocol';
import { write, writeChecked, command } from './writes.svelte';

// 0x52 SaveOutputConfig -- persists the live physical-IO block (output pins,
// output types, I2S BCK/MCK, S/PDIF RX pin) to the directory's device-global
// block. Meaningful in Independent mode (the block is the boot source);
// firmware accepts it in WithPreset mode but it stays dormant. Fire-and-forget:
// only failure surfaces; success is silent (there is no saved-readback opcode,
// so no clean-detect).
export function saveOutputConfigBaseline(s: ReadySession): void {
  void command(s, 'save output config', () => s.device.saveOutputConfig(), (r) => {
    if (!r.ok) pushNotice('warn', `Saving output config failed (${r.message ?? 'flash error'}).`);
  });
}

// Discrete (commit-paced) config commands on the writeChecked() lane. Patching on
// ack (not before the send) keeps the mirror unchanged when the device rejects the
// command; the rejection surfaces as a warn toast and the background poll
// reconciles to committed truth. Never calls syncDeviceSnapshot (would discard
// unsaved EQ/mixer edits). setOutputType's SET is queued, not applied (the switch
// is deferred in firmware) -- the optimistic patch + reconcile converge to truth.

function patchI2s(s: ReadySession, update: (i: Domain.I2sConfig) => Domain.I2sConfig): void {
  s.mirror.snapshot.i2s = update(s.mirror.snapshot.i2s);
}

// A pin reset (0xFF sentinel) resolves to a real GPIO device-side, so there
// is nothing truthful to patch optimistically -- skip the patch and let the
// staged flow's eager reconcile bring back the resolved pin (a mirrored
// sentinel would briefly render as GP255).
function unlessPinReset(pin: number, patch: () => void): () => void {
  return () => { if (pin !== Wire.Const.PIN_RESET_TO_DEFAULT) patch(); };
}

function patchOutputPin(s: ReadySession, index: number, pin: number): void {
  const pins = s.mirror.snapshot.outputPins.slice();
  pins[index] = pin;
  s.mirror.snapshot.outputPins = pins;
}

export function setOutputDataPin(s: ReadySession, pinOutputIndex: number, pin: number): Promise<boolean> {
  return writeChecked(s,
    'set output pin',
    () => s.device.setOutputPin(pinOutputIndex, pin),
    unlessPinReset(pin, () => patchOutputPin(s, pinOutputIndex, pin)),
  );
}

export function setOutputType(s: ReadySession, slot: Domain.I2sPairSlot, type: number): Promise<boolean> {
  return writeChecked(s,
    'switch output type',
    () => s.device.setOutputType(slot, type),
    () => patchI2s(s, (i) => ({
      ...i,
      outputSlotTypes: i.outputSlotTypes.map((x, j) => (j === slot ? type : x)) as [number, number, number, number],
    })),
  );
}

export function setI2sBckPin(s: ReadySession, pin: number): Promise<boolean> {
  return writeChecked(s,'set I2S BCK pin', () => s.device.setI2sBckPin(pin), unlessPinReset(pin, () => patchI2s(s, (i) => ({ ...i, bckPin: pin }))));
}

export function setMckEnabled(s: ReadySession, on: boolean): Promise<boolean> {
  return writeChecked(s,'set MCK enable', () => s.device.setMckEnable(on), () => patchI2s(s, (i) => ({ ...i, mckEnabled: on })));
}

export function setMckPin(s: ReadySession, pin: number): Promise<boolean> {
  return writeChecked(s,'set MCK pin', () => s.device.setMckPin(pin), unlessPinReset(pin, () => patchI2s(s, (i) => ({ ...i, mckPin: pin }))));
}

export function setMckMultiplier(s: ReadySession, encoded: number): Promise<boolean> {
  return writeChecked(s,'set MCK multiplier', () => s.device.setMckMultiplier(encoded), () => patchI2s(s, (i) => ({ ...i, mckMultiplierEncoded: encoded })));
}

// I2S slave-clock role (fw V21+). Deferred apply on the device: patch the
// mirror optimistically once the SET acks, matching setInputSource's lane
// (no status byte to check).
export function setI2sClockMode(s: ReadySession, mode: number): Promise<boolean> {
  return write(s,
    () => s.device.setI2sClockMode(mode),
    () => { s.mirror.snapshot.inputConfig = { ...s.mirror.snapshot.inputConfig, i2sClockMode: mode }; },
  );
}

// BCK/LRCLK pin-sharing mode (fw V21+): 0 = unified, 1 = split.
export function setI2sClockPinMode(s: ReadySession, mode: number): Promise<boolean> {
  return writeChecked(s, 'set I2S clock pin mode', () => s.device.setI2sClockPinMode(mode), () => patchI2s(s, (i) => ({ ...i, clockPinMode: mode })));
}

// Slave-mode BCK pin (fw V21+, role 1). LRCLK rides pin+1 on the device side.
export function setI2sBckPinSlave(s: ReadySession, pin: number): Promise<boolean> {
  return writeChecked(s, 'set I2S BCK pin (slave)', () => s.device.setI2sBckPin(pin, 1), unlessPinReset(pin, () => patchI2s(s, (i) => ({ ...i, bckPinSlave: pin }))));
}

// ADAT lightpipe output (fw V17+, RP2350). Not one of the heavy staged
// actions -- enabling/disabling the stream doesn't reset the audio pipeline
// -- so it writes straight through writeChecked like setI2sClockPinMode above.
export function setAdatEnable(s: ReadySession, enabled: boolean): Promise<boolean> {
  return writeChecked(s, 'set ADAT enable', () => s.device.setAdatEnable(enabled), () => {
    s.mirror.snapshot.adat = { ...s.mirror.snapshot.adat, enabled };
    // Disabling stops the stream; drop the last-known counters so a later
    // re-enable shows the "waiting for status" hint instead of frozen,
    // pre-disable numbers.
    if (!enabled) s.telemetry.adatStatus = null;
  });
}

// A pin reset (0xFF) resolves to a real GPIO device-side, so there is
// nothing truthful to patch optimistically -- same idiom as unlessPinReset:
// skip the patch and force an eager reconcile so the resolved pin lands on
// the next param-cadence tick instead of a mirrored sentinel briefly
// rendering as GP255.
export function setAdatPin(s: ReadySession, pin: number): Promise<boolean> {
  return writeChecked(s, 'set ADAT pin', () => s.device.setAdatPin(pin), () => {
    if (pin === Wire.Const.PIN_RESET_TO_DEFAULT) {
      s.mirror.requestReconcile(true);
    } else {
      s.mirror.snapshot.adat = { ...s.mirror.snapshot.adat, pin };
    }
  });
}

// ADAT lightpipe input (fw V24+, RP2350). Same writeChecked lane as the
// output pair above.
export function setAdatInputEnable(s: ReadySession, enabled: boolean): Promise<boolean> {
  return writeChecked(s, 'set ADAT input enable', () => s.device.setAdatInputEnable(enabled), () => {
    s.mirror.snapshot.inputConfig = { ...s.mirror.snapshot.inputConfig, adatInputEnabled: enabled };
    // Disabling stops acquisition; drop the last-known counters so a later
    // re-enable shows the "waiting for lock" hint instead of frozen,
    // pre-disable numbers.
    if (!enabled) s.telemetry.adatInputStatus = null;
  });
}

// Unlike the ADAT output pin (which falls back to a platform default GPIO),
// there is no default for the input -- 0xFF always resolves to unset, so the
// mirror can be patched straight to 0 with no reconcile dance.
export function setAdatInputPin(s: ReadySession, pin: number): Promise<boolean> {
  return writeChecked(s, 'set ADAT input pin', () => s.device.setAdatInputPin(pin), () => {
    s.mirror.snapshot.inputConfig = {
      ...s.mirror.snapshot.inputConfig,
      adatInputPin: pin === Wire.Const.PIN_RESET_TO_DEFAULT ? 0 : pin,
    };
  });
}

export function setAdatInputClockMode(s: ReadySession, mode: number): Promise<boolean> {
  return writeChecked(s, 'set ADAT input clock mode', () => s.device.setAdatInputClockMode(mode), () => {
    s.mirror.snapshot.inputConfig = { ...s.mirror.snapshot.inputConfig, adatInputClockMode: mode };
  });
}

// M1 — Input source switch. Pipeline reset is audible; surface an info notice
// only once the device acked. The retained RX status frame belongs to the
// previous source epoch -- drop it so a SPDIF re-entry can't show a stale lock.
export function setInputSource(s: ReadySession, source: Domain.AudioInputSource): Promise<boolean> {
  return write(s,
    () => s.device.setInputSource(source),
    () => {
      s.mirror.snapshot.inputConfig.source = source;
      s.telemetry.spdifRxStatus = null;
      pushNotice('info', 'Input source changed — firmware pipeline reset (brief audio mute).');
    },
  );
}

// M1 — S/PDIF RX pin. Action-style: status byte on rejection.
export function setSpdifRxPin(s: ReadySession, gpio: number): Promise<boolean> {
  return writeChecked(s,
    'set S/PDIF RX pin',
    () => s.device.setSpdifRxPin(gpio),
    unlessPinReset(gpio, () => { s.mirror.snapshot.inputConfig.spdifRxPin = gpio; }),
  );
}

// fw 1.1.5+ — RX pin for optional S/PDIF input 2/3. extIndex 0 = input 2
// (device instance 1), extIndex 1 = input 3 (device instance 2).
export function setSpdifRxPinExt(s: ReadySession, extIndex: number, gpio: number): Promise<boolean> {
  return writeChecked(s,
    'set S/PDIF RX pin',
    () => s.device.setSpdifRxPin(gpio, extIndex + 1),
    unlessPinReset(gpio, () => { s.mirror.snapshot.inputConfig.spdifRxPinExt[extIndex] = gpio; }),
  );
}

// fw 1.1.5+ — enable/disable optional S/PDIF input 2/3 (extIndex as above).
export function setSpdifInputEnabled(s: ReadySession, extIndex: number, on: boolean): Promise<boolean> {
  return writeChecked(s,
    'set S/PDIF input enable',
    () => s.device.setSpdifInputEnabled(extIndex + 1, on),
    () => { s.mirror.snapshot.inputConfig.spdifExtEnabled[extIndex] = on; },
  );
}

// V16 — stored input rate, shared by I2S master and ADAT master mode (the
// device is the rate authority in both). While one of them is the active
// source firmware applies the change deferred (audible pipeline reset),
// otherwise it just stores the selection.
export function setInputRate(s: ReadySession, hz: number): Promise<boolean> {
  return write(s,
    () => s.device.setInputRate(hz),
    () => {
      s.mirror.snapshot.inputConfig.i2sInputRateHz = hz;
      const src = s.mirror.snapshot.inputConfig.source;
      if (src === Domain.AudioInputSource.I2s || src === Domain.AudioInputSource.Adat) {
        pushNotice('info', 'Input rate changed — firmware pipeline reset (brief audio mute).');
      }
    },
  );
}

// V16 — I2S RX data pin per stereo pair. Action-style status byte covers
// invalid GPIO, clock/peripheral clash, or a pin already on another pair.
export function setI2sRxPin(s: ReadySession, pair: number, gpio: number): Promise<boolean> {
  return writeChecked(s,
    'set I2S RX pin',
    () => s.device.setI2sRxPin(pair, gpio),
    unlessPinReset(gpio, () => {
      const pins = s.mirror.snapshot.inputConfig.i2sRxPins.slice();
      pins[pair] = gpio;
      s.mirror.snapshot.inputConfig.i2sRxPins = pins;
    }),
  );
}

// V16 — active I2S input channel count (2/4/6/8, RP2350). The live count in
// telemetry updates via the INPUT_FORMAT notify when I2S is active.
export function setI2sInputChannels(s: ReadySession, count: number): Promise<boolean> {
  return writeChecked(s,
    'set I2S input channels',
    () => s.device.setI2sInputChannels(count),
    () => { s.mirror.snapshot.inputConfig.i2sInputChannels = count; },
  );
}
